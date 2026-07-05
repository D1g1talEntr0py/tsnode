import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJsonFile } from '../read-json-file.js';
import { tmpdir } from '../temporary-directory.js';
import type { Transformed } from './apply-transformers.js';

const noop = () => {};
const getTime = () => Math.floor(Date.now() / 1e8);

type DiskCacheEntry = {
	time: number;
	fileName: string;
};

class FileCache<ReturnType> extends Map<string, ReturnType> {
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
	cacheDirectory = tmpdir;

	// Maintained so we can remove it on Windows
	oldCacheDirectory = path.join(os.tmpdir(), 'tsx');

	/**
	 * Disk cache index keyed by cache key for O(1) lookups.
	 * Loaded lazily on first memory-cache miss so start-up cost
	 * doesn't grow with the size of the cache directory.
	 */
	diskCacheIndex: Map<string, DiskCacheEntry> | undefined;

	constructor() {
		super();

		// Handles race condition if multiple tsx instances are running (#22)
		fs.mkdirSync(this.cacheDirectory, { recursive: true });

		setImmediate(() => {
			this.expireDiskCache();
			this.removeOldCacheDirectory();
		});
	}

	getDiskCacheIndex() {
		if (!this.diskCacheIndex) {
			const index = new Map<string, DiskCacheEntry>();
			let fileNames: string[];
			try {
				fileNames = fs.readdirSync(this.cacheDirectory);
			} catch {
				fileNames = [];
			}
			for (const fileName of fileNames) {
				const [time, key] = fileName.split('-');
				if (key) {
					index.set(key, {
						time: Number(time),
						fileName,
					});
				}
			}
			this.diskCacheIndex = index;
		}
		return this.diskCacheIndex;
	}

	override get(key: string) {
		const memoryCacheHit = super.get(key);

		if (memoryCacheHit) {
			return memoryCacheHit;
		}

		const diskCacheHit = this.getDiskCacheIndex().get(key);
		if (!diskCacheHit) {
			return;
		}

		const cacheFilePath = path.join(this.cacheDirectory, diskCacheHit.fileName);
		const cachedResult = readJsonFile<ReturnType>(cacheFilePath);

		if (!cachedResult) {
			// Remove broken cache file
			this.diskCacheIndex!.delete(key);
			fs.promises.unlink(cacheFilePath).catch(noop);
			return;
		}

		// Load it into memory
		super.set(key, cachedResult);

		return cachedResult;
	}

	override set(key: string, value: ReturnType) {
		super.set(key, value);

		if (value) {
			/**
			 * Time is inaccurate by ~27.7 hours to minimize data
			 * and because this level of fidelity wont matter
			 */
			const time = getTime();
			const fileName = `${time}-${key}`;

			// Keep the disk index in sync so concurrent lookups can find it
			this.diskCacheIndex?.set(key, {
				time,
				fileName,
			});

			fs.promises.writeFile(
				path.join(this.cacheDirectory, fileName),
				JSON.stringify(value),
			).catch(noop);
		}

		return this;
	}

	expireDiskCache() {
		const time = getTime();

		for (const [key, cache] of this.getDiskCacheIndex()) {
			// Remove if older than ~7 days
			if ((time - cache.time) > 7) {
				fs.promises.unlink(path.join(this.cacheDirectory, cache.fileName)).catch(noop);
				this.diskCacheIndex!.delete(key);
			}
		}
	}

	async removeOldCacheDirectory() {
		try {
			const exists = await fs.promises.access(this.oldCacheDirectory).then(() => true);
			if (exists) {
				if ('rm' in fs.promises) {
					await fs.promises.rm(
						this.oldCacheDirectory,
						{
							recursive: true,
							force: true,
						},
					);
				} else {
					await fs.promises.rmdir(
						this.oldCacheDirectory,
						{ recursive: true },
					);
				}
			}
		} catch {}
	}
}

export default (
	process.env.TSX_DISABLE_CACHE
		? new Map<string, Transformed>()
		: new FileCache<Transformed>()
);
