import path from 'node:path';
import { noop, encoding } from '../constants';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { chmod, unlink, mkdir, readdir, rm, writeFile, stat, readFile } from 'node:fs/promises';
import { Json, type JsonDecoder } from '../json';
import { tmpdir, legacyTempDirs } from '../temporary-directory';
import type { Transformed } from '../../types';

type RequestIdentity = string[] | string;
type Cache<T> = {
	get: (key: string, identity?: RequestIdentity) => T | undefined;
	set: (key: string, value: T) => Cache<T>;
	has: (key: string) => boolean;
	clear: () => void;
};
export type CachedTransform = Transformed & { identity?: RequestIdentity };

/**
 * Bounds retained heap usage. Independent of how much is persisted to disk.
 *
 * Not a performance knob. Keys are verified buckets and Node loads each URL once,
 * so within a process a given key is requested exactly once; measured in-process
 * hit rate is low except for identical sources. Disabling this tier entirely changed neither wall time nor RSS in the measured unique-source graph.
 * Eviction is insertion-order (the oldest entry is dropped); nothing is promoted
 * on access, so this is FIFO rather than LRU. That distinction is immaterial
 * while the hit rate is zero, and the disk tier backstops any eviction.
 */
const maxMemoryCacheEntries = 64;
const maxRetainedBytes = 8 * 1024 * 1024;
const maxPendingWriteEntries = 64;

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

/**
 * Maximum concurrency for sweeping the cache directory. The sweep is I/O bound, so a higher concurrency is better than a lower one, but too high and the OS will
 * start throttling. 16 was measured to be the sweet spot on macOS.
 * The concurrency is limited to the number of entries in the cache directory, so if there are fewer than 16 entries, it will only use that many concurrent operations.
 * This is a best-effort limit; if the OS throttles, the sweep will still complete, but it may take longer.
 * The concurrency is also limited to the number of available file descriptors, so if the process is running with a low ulimit, it may not be able to open 16 files at once.
 * This is a best-effort limit;
 */
const maxSweepConcurrency = 16;

/** Records when the last sweep ran. Not a cache entry; excluded from expiry. */
const sweepMarkerName = '.last-sweep';

export const forEachConcurrent = async <T>(values: T[], concurrency: number, task: (value: T) => Promise<void>) => {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError(`Concurrency must be a positive integer, got ${concurrency}`);
	}

	const iterator = values.values();
	const worker = async () => {
		while (true) {
			const next = iterator.next();
			if (next.done) { return }

			await task(next.value);
		}
	};

	await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
};

/**
 * A file-based cache that also keeps entries in memory for fast access.
 * Implements the `Cache<T>` interface.
 */
class FileCache<T extends CachedTransform> implements Cache<T> {
	#memoryCache = new Map<string, { value: T; bytes: number }>();
	#memoryCacheBytes = 0;
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
	#oldCacheDirectories: string[] = legacyTempDirs;
	#diskCacheWrites = 0;
	/**
	 * Entries produced during this process that have not yet been written out.
	 * Serialized payloads are bounded by entry count and UTF-8 byte length.
	 * Disk writes run on the next event-loop turn, on queue overflow, or on exit.
	 */
	#pendingWrites = new Map<string, { serialized: string; bytes: number }>();
	#pendingWriteBytes = 0;
	#flushScheduled = false;
	#exitHookRegistered = false;
	#cacheDirectoryReady: Promise<void> | undefined;
	#cacheDirectoryReadyPath: string | undefined;
	#cacheDirectoryExists: boolean | undefined;
	#cacheDirectoryWasMissing = false;
	#maintenanceScheduled = false;
	#temporarySequence = 0;
	#temporarySuffix: string | undefined;
	readonly #decode: JsonDecoder<T>;

	constructor(decoder: JsonDecoder<T>) {
		this.#decode = decoder;
	}

	/**
	 * Returns the cached value for the given key, or undefined if the key is not in the cache.
	 * If the key is not in the memory cache, it will attempt to read it from disk.
	 * If the key is found on disk, it will be loaded into memory and returned.
	 * @param key The key to look up in the cache.
	 * @returns The cached value, or undefined if the key is not in the cache.
	 * @param identity Exact request fields required for a verified hit.
	 */
	get(key: string, identity?: RequestIdentity) {
		return this.#getLocal(key, identity) ?? this.#acceptDiskHit(key, this.#readDiskEntry(key, identity));
	}

	/**
	 * Returns the cached value for the given key, or undefined if the key is not in the cache.
	 * If the key is not in the memory cache, it will attempt to read it from disk asynchronously.
	 * If the key is found on disk, it will be loaded into memory and returned.
	 * @param key The key to look up in the cache.
	 * @returns A promise that resolves to the cached value, or undefined if the key is not in the cache.
	 * @param identity Exact request fields required for a verified hit.
	 */
	async getAsync(key: string, identity?: RequestIdentity) {
		return this.#getLocal(key, identity) ?? this.#acceptDiskHit(key, await this.#readDiskEntryAsync(key, identity));
	}

	/**
	 * Sets the cached value for the given key. If the cache exceeds the maximum number of entries, the oldest entry will be removed.
	 * If the cache is not disabled, the value will also be written to disk asynchronously.
	 * @param key The key to set in the cache.
	 * @param value The value to set in the cache.
	 * @returns The cache instance (for chaining).
	 */
	set(key: string, value: T) {
		const { identity, ...result } = value;
		const serialized = identity ? `{"identity":${typeof identity === 'string' ? identity : Json.serialize(identity)},"value":${Json.serialize(result)}}` : Json.serialize(value);
		if (serialized === undefined) { throw new TypeError('Cache value must serialize to JSON') }
		const bytes = Buffer.byteLength(serialized, encoding);

		this.#setMemory(key, value, bytes);

		const previous = this.#pendingWrites.get(key);

		if (previous !== undefined) {
			this.#pendingWriteBytes -= previous.bytes;
			this.#pendingWrites.delete(key);
		}

		if (value && bytes <= maxRetainedBytes && this.#diskCacheWrites < maxDiskCacheWrites) {
			this.#diskCacheWrites += 1;

			if (this.#pendingWrites.size >= maxPendingWriteEntries || this.#pendingWriteBytes + bytes > maxRetainedBytes) {
				this.#flushPendingWritesSync();
			}

			this.#pendingWrites.set(key, { serialized, bytes });
			this.#pendingWriteBytes += bytes;
			this.#scheduleFlush();
		}

		return this;
	}

	/**
	 * Returns true if the cache contains the given key, either in memory or on disk.
	 * @param key The key to check in the cache.
	 * @returns True if the cache contains the key, false otherwise.
	 */
	has(key: string) {
		return this.#memoryCache.has(key) || this.#pendingWrites.has(key);
	}

	/** Clears the cache, both in memory and pending disk writes. */
	clear() {
		this.#memoryCache.clear();
		this.#memoryCacheBytes = 0;
		this.#pendingWrites.clear();
		this.#pendingWriteBytes = 0;
	}

	/**
	 * Returns true at most once per `minSweepIntervalMs`. The marker is written
	 * before sweeping so concurrent processes don't all sweep at once.
	 * @returns True if the sweep was claimed, false if it was already claimed by another process.
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

	/**
	 * Schedules a maintenance sweep of the cache directory, if one is not already scheduled. The sweep will remove expired entries and old cache directories.
	 * This is a best-effort operation; failures are ignored and the sweep will be retried on the next disk hit.
	 */
	#scheduleMaintenance() {
		if (this.#maintenanceScheduled) { return }

		this.#maintenanceScheduled = true;
		// Detached from any await chain, so failures must not escape as an
		// unhandled rejection. Maintenance is best-effort; it stays "scheduled"
		// on failure so a broken cache directory isn't retried every disk hit.
		setImmediate(() => {
			void (async () => {
				try {
					if (!await this.#claimSweep()) { return }

					await this.#expireDiskCache();
					await this.#removeOldCacheDirectories();
				} catch { /* ignored */ }
			})();
		});
	}

	/**
	 * Returns the file path for the given cache key. The file path is based on the cache directory and the key.
	 * @param key The cache key to get the file path for.
	 * @returns The file path for the given cache key.
	 */
	#cacheFilePath(key: string) {
		return path.join(this.#cacheDirectory, key);
	}

	/**
	 * Ensures that the cache directory exists. If it does not exist, it will be created.
	 * @returns A promise that resolves when the cache directory is ready.
	 */
	#ensureCacheDirectory() {
		if (this.#cacheDirectoryReadyPath !== this.#cacheDirectory) {
			this.#cacheDirectoryReadyPath = this.#cacheDirectory;
			this.#cacheDirectoryExists = undefined;
			this.#cacheDirectoryReady = mkdir(this.#cacheDirectory, { recursive: true, mode: 0o700 })
				.then(async () => {
					try {
						await chmod(this.#cacheDirectory, 0o700);
					} catch {
						// Best-effort: a lock down failure should not break cache setup on
						// filesystems or platforms that reject chmod for the temp dir.
					}
				})
				.then(noop);
		}

		this.#cacheDirectoryExists = true;

		return this.#cacheDirectoryReady!;
	}

	/**
	 * Ensures that the cache directory exists synchronously. If it does not exist, it will be created.
	 * This is used for synchronous operations that need to ensure the cache directory exists before proceeding.
	 */
	#ensureCacheDirectorySync() {
		if (this.#cacheDirectoryReadyPath !== this.#cacheDirectory) {
			mkdirSync(this.#cacheDirectory, { recursive: true, mode: 0o700 });
			this.#cacheDirectoryReadyPath = this.#cacheDirectory;
			this.#cacheDirectoryExists = true;
		} else {
			this.#cacheDirectoryExists = true;
		}

		try {
			chmodSync(this.#cacheDirectory, 0o700);
		} catch {
			// Best-effort on platforms/filesystems that reject chmod for temp dirs.
		}
	}

	/**
	 * Returns true if the cache directory exists and is readable. If the cache directory does not exist, it will be created.
	 * @returns True if the cache directory exists and is readable, false otherwise.
	 */
	#canReadDisk() {
		if (this.#cacheDirectoryExists) { return true }

		if (existsSync(this.#cacheDirectory)) {
			this.#cacheDirectoryExists = true;
			return true;
		}

		this.#cacheDirectoryWasMissing = true;
		return false;
	}

	/**
	 * Sets the cached value for the given key in memory. If the cache exceeds the maximum number of entries, the oldest entry will be removed.
	 * @param key The key to set in the cache.
	 * @param value The value to set in the cache.
	 * @param bytes The serialized value size in bytes.
	 */
	#setMemory(key: string, value: T, bytes: number) {
		const previous = this.#memoryCache.get(key);
		if (previous) {
			this.#memoryCacheBytes -= previous.bytes;
			this.#memoryCache.delete(key);
		}

		if (bytes > maxRetainedBytes) { return }

		while (this.#memoryCache.size >= maxMemoryCacheEntries || this.#memoryCacheBytes + bytes > maxRetainedBytes) {
			const oldestKey = this.#memoryCache.keys().next().value!;
			this.#memoryCacheBytes -= this.#memoryCache.get(oldestKey)!.bytes;
			this.#memoryCache.delete(oldestKey);
		}

		this.#memoryCache.set(key, { value, bytes });
		this.#memoryCacheBytes += bytes;
	}

	/**
	 * Shared by `get`/`getAsync`: memory, then not-yet-flushed writes.
	 * @param key The key to retrieve from the cache.
	 * @returns The cached value if found, otherwise undefined.
	 * @param identity Exact request fields required for a verified hit.
	 */
	#getLocal(key: string, identity?: RequestIdentity) {
		const memoryCacheHit = this.#memoryCache.get(key);
		if (memoryCacheHit && (!identity || (typeof identity === 'string' ? memoryCacheHit.value.identity === identity : Array.isArray(memoryCacheHit.value.identity) && memoryCacheHit.value.identity.length === identity.length && identity.every((part, index) => part === memoryCacheHit.value.identity![index])))) { return memoryCacheHit.value }

		// Queued but not yet on disk: reading the file would fail and the entry
		// would be discarded as corrupt.
		const pending = this.#pendingWrites.get(key);
		if (pending !== undefined) {
			const pendingHit = this.#decodeEntry(pending.serialized, identity);
			if (pendingHit !== undefined) {
				this.#setMemory(key, pendingHit, pending.bytes);
				return pendingHit;
			}
		}

		return undefined;
	}

	/**
	 * Verifies the request header before decoding the transformed payload.
	 * @param serialized Complete disk or pending payload.
	 * @param identity Exact request fields required for a verified hit.
	 */
	#decodeEntry(serialized: string, identity?: RequestIdentity) {
		if (!identity) { return Json.decode(serialized, this.#decode) }

		const prefix = `{"identity":${typeof identity === 'string' ? identity : Json.serialize(identity)},"value":`;

		if (!serialized.startsWith(prefix) || !serialized.endsWith('}')) { return undefined }

		const result = Json.decode(serialized.slice(prefix.length, -1), this.#decode);

		if (result) { result.identity = identity }

		return result;
	}

	/**
	 * Loads a disk hit into memory and schedules maintenance. Returns the cached value if found, otherwise undefined.
	 * @param key The key to retrieve from the cache.
	 * @param cachedResult The cached value retrieved from disk.
	 * @returns The cached value if found, otherwise undefined.
	 */
	#acceptDiskHit(key: string, cachedResult: { value: T; bytes: number } | undefined) {
		if (!cachedResult) { return undefined }

		// Load it into memory
		this.#setMemory(key, cachedResult.value, cachedResult.bytes);
		if (!this.#cacheDirectoryWasMissing) { this.#scheduleMaintenance() }

		return cachedResult.value;
	}

	/**
	 * Reads and parses one entry from disk.
	 *
	 * Invalid entries are misses; deleting them could race an atomic replacement.
	 * @param key The key to retrieve from the cache.
	 * @returns The cached value if found, otherwise undefined.
	 * @param identity Exact request fields required for a verified hit.
	 */
	#readDiskEntry(key: string, identity?: RequestIdentity) {
		if (!this.#canReadDisk()) { return undefined }

		const filePath = this.#cacheFilePath(key);
		if (this.#cacheDirectoryWasMissing && !existsSync(filePath)) { return undefined }

		try {
			const serialized = readFileSync(filePath, encoding);
			const decoded = this.#decodeEntry(serialized, identity);

			if (decoded === undefined) { throw new TypeError('Invalid cache entry') }

			return { value: decoded, bytes: Buffer.byteLength(serialized, encoding) };
		} catch {
			return undefined;
		}
	}

	/**
	 * Reads and parses one entry from disk asynchronously.
	 * @param key The key to retrieve from the cache.
	 * @returns The cached value if found, otherwise undefined.
	 * @param identity Exact request fields required for a verified hit.
	 */
	async #readDiskEntryAsync(key: string, identity?: RequestIdentity) {
		if (!this.#canReadDisk()) { return undefined }

		const filePath = this.#cacheFilePath(key);

		try {
			const serialized = await readFile(filePath, encoding);
			const decoded = this.#decodeEntry(serialized, identity);
			if (decoded === undefined) { throw new TypeError('Invalid cache entry') }

			return { value: decoded, bytes: Buffer.byteLength(serialized, encoding) };
		} catch {
			return undefined;
		}
	}

	/** Schedules a flush of pending writes to disk. If a flush is already scheduled, this does nothing. */
	#scheduleFlush() {
		this.#ensureFlushOnExit();

		if (this.#flushScheduled) { return }

		this.#flushScheduled = true;
		setImmediate(() => {
			this.#flushScheduled = false;
			void this.#flushPendingWrites();
		});
	}

	/** Ensures that a flush of pending writes is registered to occur on process exit. If already registered, this does nothing. */
	#ensureFlushOnExit() {
		if (this.#exitHookRegistered) { return }

		this.#exitHookRegistered = true;
		// Covers process.exit() / a short script finishing before the flush runs
		process.once('exit', () => this.#flushPendingWritesSync());
	}

	/**
	 * Drains queued entries.
	 *
	 * Writes are synchronous by design. Batches normally wait for `setImmediate`,
	 * but overflow drains during loading to bound retention without losing entries.
	 * Making writes async only added libuv thread pool dispatch overhead, which
	 * measured ~17ms for 100 small files versus ~1.2ms synchronously, and kept
	 * the event loop open until it drained.
	 */
	#flushPendingWrites() {
		this.#flushPendingWritesSync();

		// Deliberately no sweep here: entries written moments ago are the freshest
		// in the cache, and getting them all cost ~10ms per cold run. Maintenance
		// is driven by disk hits instead, where stale entries actually accumulate.
		return Promise.resolve();
	}

	/** Writes and clears the queue. Also used from the exit hook. */
	#flushPendingWritesSync() {
		if (this.#pendingWrites.size === 0) { return }

		const queued = [...this.#pendingWrites];
		this.#pendingWrites.clear();
		this.#pendingWriteBytes = 0;

		try {
			this.#ensureCacheDirectorySync();
		} catch {
			return;
		}

		for (const [ key, { serialized, bytes } ] of queued) {
			const filePath = this.#cacheFilePath(key);
			this.#temporarySuffix ??= `${process.pid}-${Math.random().toString(36).slice(2)}`;
			const temporaryPath = `${filePath}.${this.#temporarySuffix}-${this.#temporarySequence++}.tmp`;
			let descriptor: number | undefined;
			let created = false;

			try {
				descriptor = openSync(temporaryPath, 'wx', 0o600);
				created = true;
				let written = writeSync(descriptor, serialized);

				if (written !== bytes) {
					const buffer = Buffer.from(serialized, encoding);
					while (written < bytes) {
						const progress = writeSync(descriptor, buffer, written, bytes - written);
						if (progress === 0) { throw new Error('Incomplete cache write') }
						written += progress;
					}
				}

				closeSync(descriptor);
				descriptor = undefined;
				renameSync(temporaryPath, filePath);
				created = false;
			} catch { /* ignored */ } finally {
				if (descriptor !== undefined) { try { closeSync(descriptor) } catch { /* ignored */ } }

				if (created) { try { unlinkSync(temporaryPath) } catch { /* ignored */ } }
			}
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

		await forEachConcurrent(fileNames, maxSweepConcurrency, async (fileName) => {
			if (fileName === sweepMarkerName) { return }

			const filePath = path.join(this.#cacheDirectory, fileName);
			try {
				if ((await stat(filePath)).mtimeMs < expiredBefore) { await unlink(filePath) }
			} catch { /* ignored */ }
		});
	}

	/**
	 * Removes a cache directory and all its contents. Used to clean up superseded cache directories.
	 * @param directory The cache directory to remove.
	 * @returns A promise that resolves when the cache directory is removed.
	 */
	async #cacheRemover(directory: string) {
		return rm(directory, { recursive: true, force: true }).catch(noop);
	}


	/**
	 * Removes superseded cache directories. This is a best-effort operation; failures are ignored and the directories will be retried on the next maintenance sweep.
	 * @returns A promise that resolves when the old cache directories are removed.
	 */
	async #removeOldCacheDirectories() {
		await Promise.all(this.#oldCacheDirectories.map(this.#cacheRemover));
	}
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const decodeSourceMap = (value: unknown): Transformed['map'] => {
	if (!isRecord(value)) { return undefined }

	const version = value['version'];
	const sources = value['sources'];
	const names = value['names'];
	const mappings = value['mappings'];
	const sourcesContent = value['sourcesContent'];
	const sourceRoot = value['sourceRoot'];
	const file = value['file'];
	if (typeof version !== 'number' || !isStringArray(sources) || !isStringArray(names) || typeof mappings !== 'string') { return undefined }
	if (sourcesContent !== undefined && !isStringArray(sourcesContent)) { return undefined }
	if (sourceRoot !== undefined && typeof sourceRoot !== 'string') { return undefined }
	if (file !== undefined && typeof file !== 'string') { return undefined }

	const sourceMap: NonNullable<Transformed['map']> = { version, sources, names, mappings };
	if (sourcesContent !== undefined) { sourceMap.sourcesContent = sourcesContent }
	if (sourceRoot !== undefined) { sourceMap.sourceRoot = sourceRoot }
	if (file !== undefined) { sourceMap.file = file }

	return sourceMap;
};

const decodeTransformed = (value: unknown): CachedTransform | undefined => {
	if (!isRecord(value)) { return undefined }

	const code = value['code'];

	if (typeof code !== 'string') { return undefined }

	const identity = value['identity'];

	if (identity !== undefined && !isStringArray(identity)) { return undefined }

	const transformed: CachedTransform = { code };

	if (identity !== undefined) { transformed.identity = identity }

	const rawMap = value['map'];

	if (rawMap === undefined) { return transformed }

	const map = decodeSourceMap(rawMap);

	if (!map) { return undefined }

	transformed.map = map;

	return transformed;
};

const disabledCache: Cache<CachedTransform> & { getAsync: (key: string) => Promise<undefined> } = {
	get: (_key: string) => undefined,
	getAsync: (_key: string) => Promise.resolve(undefined),
	set: (_key: string, _value: CachedTransform) => disabledCache,
	has: (_key: string) => false,
	clear: noop
};

export default (process.env['TSNODE_DISABLE_CACHE'] ? disabledCache : new FileCache(decodeTransformed));
