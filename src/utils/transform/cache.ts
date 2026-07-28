import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unlink, mkdir, readdir, rm, writeFile, stat, readFile } from 'node:fs/promises';
import { Json, type JsonString } from '../json';
import { tmpdir, legacyTmpdirs } from '../temporary-directory';
import type { Transformed } from './index';

const noop = () => {};

/**
 * Bounds retained heap usage. Independent of how much is persisted to disk.
 *
 * Not a performance knob. Keys are content hashes and Node loads each URL once,
 * so within a process a given key is requested exactly once; measured in-process
 * hit rate is 0%. Disabling this tier entirely changed neither wall time nor RSS.
 * Eviction is insertion-order (the oldest entry is dropped); nothing is promoted
 * on access, so this is FIFO rather than LRU. That distinction is immaterial
 * while the hit rate is zero, and the disk tier backstops any eviction.
 */
const maxMemoryCacheEntries = 64;

/**
 * Per-process cap on entries persisted to disk. Previously this reused
 * `maxMemoryCacheEntries`, which meant only the first 64 modules of a project
 * were ever written out — every subsequent module was re-transformed on every
 * "warm" run. Sized to comfortably cover a large module graph.
 */
const maxDiskCacheWrites = 2000;

/** Entries untouched for this long are swept during maintenance. */
const maxCacheAgeMs = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum interval between disk sweeps.
 *
 * Maintenance costs one `readdir` plus a `stat` per cache entry, and it holds
 * the event loop open until it finishes. Running it on every process made
 * startup scale with cache directory size (~29ms -> ~88ms at 1500 entries).
 * The marker file below reduces that to once per day per cache directory.
 */
const minSweepIntervalMs = 24 * 60 * 60 * 1000;

/** Records when the last sweep ran. Not a cache entry; excluded from expiry. */
const sweepMarkerName = '.last-sweep';

type Cache<T> = {
	get: (key: string) => T | undefined;
	set: (key: string, value: T) => Cache<T>;
	has: (key: string) => boolean;
	clear: () => void;
};

class FileCache<T> implements Cache<T> {
	#memoryCache = new Map<string, T>();
	/**
	 * By using tmpdir, the expectation is for the OS to clean any files
	 * that haven't been read for a while.
	 *
	 * macOS - 3 days: https://superuser.com/a/187105
	 * Linux - https://serverfault.com/a/377349
	 *
	 * Note on Windows, temp files are not cleaned up automatically.
	 * https://superuser.com/a/1599897
	 */
	#cacheDirectory = tmpdir;
	// Superseded layouts, removed opportunistically (notably on Windows, where
	// the OS does not sweep temp files itself)
	#oldCacheDirectories: string[] = legacyTmpdirs;
	#diskCacheWrites = 0;
	/**
	 * Entries produced during this process that have not yet been written out.
	 * Writes are deferred so the (synchronous) module load hook never blocks on
	 * disk I/O; they are flushed on the next event-loop turn, or synchronously
	 * on exit if the process ends first.
	 */
	#pendingWrites = new Map<string, T>();
	#flushScheduled = false;
	#exitHookRegistered = false;
	#cacheDirectoryReady: Promise<void> | undefined;
	#cacheDirectoryReadyPath: string | undefined;
	#maintenanceScheduled = false;

	get(key: string) {
		return this.#getLocal(key) ?? this.#acceptDiskHit(key, this.#readDiskEntry(key));
	}

	async getAsync(key: string) {
		return this.#getLocal(key) ?? this.#acceptDiskHit(key, await this.#readDiskEntryAsync(key));
	}

	set(key: string, value: T) {
		this.#setMemory(key, value);

		if (value && this.#diskCacheWrites < maxDiskCacheWrites) {
			this.#diskCacheWrites += 1;

			// Queue instead of writing inline: serialization + writeFileSync
			// would otherwise run inside the load hook for every cache miss.
			this.#pendingWrites.set(key, value);
			this.#scheduleFlush();
		}

		return this;
	}

	has(key: string) {
		return this.#memoryCache.has(key) || this.#pendingWrites.has(key);
	}

	clear() {
		this.#memoryCache.clear();
		this.#pendingWrites.clear();
	}

	/**
	 * Returns true at most once per `minSweepIntervalMs`. The marker is written
	 * before sweeping so concurrent processes don't all sweep at once.
	 */
	async #claimSweep() {
		const markerPath = path.join(this.#cacheDirectory, sweepMarkerName);

		try {
			const { mtimeMs } = await stat(markerPath);
			if (Date.now() - mtimeMs < minSweepIntervalMs) { return false }
		} catch {
			// No marker yet: first sweep for this cache directory.
		}

		try {
			await this.#ensureCacheDirectory();
			await writeFile(markerPath, '');
		} catch {
			return false;
		}

		return true;
	}

	#scheduleMaintenance() {
		if (this.#maintenanceScheduled) { return }

		this.#maintenanceScheduled = true;
		// Detached from any await chain, so failures must not escape as an
		// unhandled rejection. Maintenance is best-effort; it stays "scheduled"
		// on failure so a broken cache directory isn't retried every disk hit.
		setImmediate(async () => {
			try {
				if (!await this.#claimSweep()) { return }

				await this.#expireDiskCache();
				await this.#removeOldCacheDirectories();
			} catch {}
		});
	}

	#cacheFilePath(key: string) {
		return path.join(this.#cacheDirectory, key);
	}

	#ensureCacheDirectory() {
		if (this.#cacheDirectoryReadyPath !== this.#cacheDirectory) {
			this.#cacheDirectoryReadyPath = this.#cacheDirectory;
			this.#cacheDirectoryReady = mkdir(this.#cacheDirectory, { recursive: true }).then(noop);
		}

		return this.#cacheDirectoryReady!;
	}

	#ensureCacheDirectorySync() {
		if (this.#cacheDirectoryReadyPath !== this.#cacheDirectory) {
			mkdirSync(this.#cacheDirectory, { recursive: true });
			this.#cacheDirectoryReadyPath = this.#cacheDirectory;
		}
	}

	#setMemory(key: string, value: T) {
		if (!this.#memoryCache.has(key) && this.#memoryCache.size >= maxMemoryCacheEntries) {
			const oldestKey = this.#memoryCache.keys().next().value;
			if (oldestKey !== undefined) { this.#memoryCache.delete(oldestKey) }
		}

		this.#memoryCache.set(key, value);
	}

	/** Shared by `get`/`getAsync`: memory, then not-yet-flushed writes. */
	#getLocal(key: string) {
		const memoryCacheHit = this.#memoryCache.get(key);
		if (memoryCacheHit) { return memoryCacheHit }

		// Queued but not yet on disk: reading the file would fail and the entry
		// would be discarded as corrupt.
		const pendingHit = this.#pendingWrites.get(key);
		if (pendingHit) {
			this.#setMemory(key, pendingHit);
			return pendingHit;
		}

		return undefined;
	}

	#acceptDiskHit(key: string, cachedResult: T | undefined) {
		if (!cachedResult) { return undefined }

		// Load it into memory
		this.#setMemory(key, cachedResult);
		this.#scheduleMaintenance();

		return cachedResult;
	}

	/**
	 * Reads and parses one entry.
	 *
	 * A missing file is an ordinary miss, not corruption. Unlinking on every miss
	 * cost a wasted syscall per module on cold runs (~4.4ms for 300 modules in a
	 * CPU profile), so only entries that exist but cannot be read are removed.
	 */
	#readDiskEntry(key: string) {
		const filePath = this.#cacheFilePath(key);

		try {
			return Json.parse(readFileSync(filePath, 'utf8') as JsonString<T>);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				unlink(filePath).catch(noop);
			}

			return undefined;
		}
	}

	async #readDiskEntryAsync(key: string) {
		const filePath = this.#cacheFilePath(key);

		try {
			return Json.parse(await readFile(filePath, 'utf8') as JsonString<T>);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				unlink(filePath).catch(noop);
			}

			return undefined;
		}
	}

	#scheduleFlush() {
		this.#ensureFlushOnExit();

		if (this.#flushScheduled) { return }

		this.#flushScheduled = true;
		setImmediate(() => {
			this.#flushScheduled = false;
			this.#flushPendingWrites();
		});
	}

	#ensureFlushOnExit() {
		if (this.#exitHookRegistered) { return }

		this.#exitHookRegistered = true;
		// Covers process.exit() / a short script finishing before the flush runs
		process.once('exit', () => this.#flushPendingWritesSync());
	}

	/**
	 * Drains queued entries.
	 *
	 * Writes are synchronous by design. The deferral to `setImmediate` is what
	 * keeps them out of the (synchronous) load hook; making the writes
	 * themselves async only added libuv threadpool dispatch overhead, which
	 * measured ~17ms for 100 small files versus ~1.2ms synchronously, and kept
	 * the event loop open until it drained.
	 */
	#flushPendingWrites() {
		this.#flushPendingWritesSync();

		// Deliberately no sweep here: entries written moments ago are the freshest
		// in the cache, and statting them all cost ~10ms per cold run. Maintenance
		// is driven by disk hits instead, where stale entries actually accumulate.
		return Promise.resolve();
	}

	/** Writes and clears the queue. Also used from the exit hook. */
	#flushPendingWritesSync() {
		if (this.#pendingWrites.size === 0) { return }

		const queued = [...this.#pendingWrites];
		this.#pendingWrites.clear();

		try {
			this.#ensureCacheDirectorySync();
		} catch {
			return;
		}

		for (const [ key, value ] of queued) {
			try {
				writeFileSync(this.#cacheFilePath(key), JSON.stringify(value));
			} catch {}
		}
	}

	/**
	 * Sweeps entries untouched for longer than `maxCacheAgeMs`. Entry age comes
	 * from the filesystem's mtime rather than a timestamp encoded in the file
	 * name, which is what lets lookups be a direct read.
	 */
	async #expireDiskCache() {
		let fileNames: string[];
		try { fileNames = await readdir(this.#cacheDirectory) } catch { return }

		const expiredBefore = Date.now() - maxCacheAgeMs;

		await Promise.all(fileNames.map(async (fileName) => {
			if (fileName === sweepMarkerName) { return }

			const filePath = path.join(this.#cacheDirectory, fileName);
			try {
				if ((await stat(filePath)).mtimeMs < expiredBefore) { await unlink(filePath) }
			} catch {}
		}));
	}

	async #cacheRemover(directory: string) {
		return rm(directory, { recursive: true, force: true }).catch(noop);
	}


	async #removeOldCacheDirectories() {
		await Promise.all(this.#oldCacheDirectories.map(this.#cacheRemover));
	}
}

export default (process.env['TSNODE_DISABLE_CACHE'] ? new Map<string, Transformed>() : new FileCache<Transformed>());
