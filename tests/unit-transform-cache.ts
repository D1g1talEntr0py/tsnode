import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { utimesSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		chmod: vi.fn(actual.chmod.bind(actual)),
	};
});

import cache, { forEachConcurrent } from '../src/utils/transform/cache';
import { tmpdir } from '../src/utils/temporary-directory';

const cacheDirectory = tmpdir;
const markerPath = path.join(cacheDirectory, '.last-sweep');
const isPosix = process.platform !== 'win32';

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

const settle = async (turns = 8) => {
	for (let turn = 0; turn < turns; turn += 1) {
		await nextTurn();
	}
};

const cacheFilePath = (key: string) => path.join(cacheDirectory, key);

const trackedPaths = new Set<string>();

const trackPath = (filePath: string) => {
	trackedPaths.add(filePath);
	return filePath;
};

const cleanupTrackedPaths = () => {
	for (const filePath of trackedPaths) {
		fs.rmSync(filePath, { recursive: true, force: true });
	}

	trackedPaths.clear();
	fs.rmSync(markerPath, { force: true });
};

describe('transform cache', () => {
	beforeEach(() => {
		cache.clear();
		fs.rmSync(markerPath, { force: true });
		cleanupTrackedPaths();
	});

	afterEach(async () => {
		cache.clear();
		await settle();
		cleanupTrackedPaths();
	});

	test('returns memory cache hits directly', () => {
		const key = `memory-${randomUUID()}`;
		const transformed = { code: 'export const value = 1;' };

		expect(cache.set(key, transformed)).toBe(cache);

		expect(cache.get(key)).toBe(transformed);
		expect(cache.has(key)).toBe(true);
	});

	test('writes queued entries to disk on the next turn', async () => {
		const key = `queued-${randomUUID()}`;
		const value = { code: 'export const value = 1;' };
		const filePath = trackPath(cacheFilePath(key));

		cache.set(key, value);
		expect(fs.existsSync(filePath)).toBe(false);
		expect(cache.has(key)).toBe(true);

		await settle();

		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.readFileSync(filePath, 'utf8')).toBe(JSON.stringify(value));
		if (isPosix) {
			expect(fs.statSync(cacheDirectory).mode & 0o777).toBe(0o700);
			expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
		}
	});

	test('ignores chmod failures while creating the cache directory', async () => {
		const key = `chmod-failure-${randomUUID()}`;
		const value = { code: 'export const value = 1;' };
		const filePath = trackPath(cacheFilePath(key));
		const chmodMock = vi.mocked(fsPromises.chmod);
		chmodMock.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EPERM' }));

		cache.set(key, value);
		await settle();

		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.readFileSync(filePath, 'utf8')).toBe(JSON.stringify(value));
	});

	test('ignores synchronous chmod failures while flushing cache entries', async () => {
		const key = `chmod-sync-failure-${randomUUID()}`;
		const value = { code: 'export const value = 1;' };
		const filePath = trackPath(cacheFilePath(key));
		const chmodSyncSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(((target: fs.PathLike | number, mode?: number) => {
			const fileName = String(target);
			if (fileName === cacheDirectory || fileName === filePath) {
				throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
			}
			return undefined as never;
		}) as typeof fs.chmodSync);

		cache.set(key, value);
		await settle();

		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.readFileSync(filePath, 'utf8')).toBe(JSON.stringify(value));
		chmodSyncSpy.mockRestore();
	});

	test('serves queued entries before they are written', async () => {
		const key = `pending-${randomUUID()}`;
		const value = { code: 'export const value = 1;' };
		const filePath = trackPath(cacheFilePath(key));

		cache.set(key, value);
		expect(fs.existsSync(filePath)).toBe(false);
		expect(cache.get(key)).toBe(value);
		expect(cache.has(key)).toBe(true);

		await settle();
		expect(fs.existsSync(filePath)).toBe(true);
	});

	test('clear discards pending writes before they flush', async () => {
		const key = `cleared-${randomUUID()}`;
		const value = { code: 'export const value = 1;' };
		const filePath = trackPath(cacheFilePath(key));

		cache.set(key, value);
		cache.clear();
		await settle();

		expect(fs.existsSync(filePath)).toBe(false);
		expect(cache.has(key)).toBe(false);
	});

	test('expires old disk entries during maintenance', async () => {
		const oldKey = `expired-${randomUUID()}`;
		const freshKey = `fresh-${randomUUID()}`;
		const oldPath = trackPath(cacheFilePath(oldKey));
		const freshPath = trackPath(cacheFilePath(freshKey));
		const oldValue = { code: 'export const oldValue = true;' };
		const freshValue = { code: 'export const freshValue = true;' };
		const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

		fs.writeFileSync(oldPath, JSON.stringify(oldValue));
		fs.writeFileSync(freshPath, JSON.stringify(freshValue));
		utimesSync(oldPath, oldTime, oldTime);

		expect(cache.get(freshKey)).toEqual(freshValue);
		await expect.poll(() => fs.existsSync(oldPath), { timeout: 1_000 }).toBe(false);
		expect(fs.existsSync(freshPath)).toBe(true);
	});

	test('reads disk entries directly without indexing the directory', () => {
		const key = `disk-${randomUUID()}`;
		const value = { code: 'export const value = 2;' };
		const filePath = trackPath(cacheFilePath(key));

		fs.writeFileSync(filePath, JSON.stringify(value));

		expect(cache.get(key)).toEqual(value);
		expect(cache.has(key)).toBe(true);
	});

	test('drops corrupted disk cache entries', async () => {
		const key = `broken-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));

		fs.writeFileSync(filePath, '{"broken": }');

		expect(cache.get(key)).toBeUndefined();

		// Unlink is fire-and-forget; poll instead of a fixed turn count, which is flaky under CI load.
		await expect.poll(() => fs.existsSync(filePath), { timeout: 1_000 }).toBe(false);
	});

	test('drops valid JSON with the wrong transform shape', async () => {
		const key = `wrong-shape-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));

		fs.writeFileSync(filePath, JSON.stringify({ output: 'export {}' }));

		expect(cache.get(key)).toBeUndefined();
		await expect.poll(() => fs.existsSync(filePath), { timeout: 1_000 }).toBe(false);
	});

	test('recovers a corrupted disk entry when it is replaced', async () => {
		const key = `recovered-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		const replacement = { code: 'export const recovered = true;' };

		fs.writeFileSync(filePath, '{not valid json');
		expect(cache.get(key)).toBeUndefined();
		await settle();

		cache.set(key, replacement);
		await settle();

		expect(cache.get(key)).toEqual(replacement);
		expect(fs.readFileSync(filePath, 'utf8')).toBe(JSON.stringify(replacement));
	});

	test('bounds concurrent cache maintenance work', async () => {
		let activeTasks = 0;
		let maximumActiveTasks = 0;

		await forEachConcurrent(Array.from({ length: 40 }, (_, index) => index), 4, async () => {
			activeTasks += 1;
			maximumActiveTasks = Math.max(maximumActiveTasks, activeTasks);
			await nextTurn();
			activeTasks -= 1;
		});

		expect(maximumActiveTasks).toBe(4);
	});

	test('processes undefined values in bounded workers', async () => {
		const processed: Array<number | undefined> = [];

		await forEachConcurrent<number | undefined>([ 1, undefined, 2 ], 2, async value => {
			processed.push(value);
		});

		expect(processed).toHaveLength(3);
		expect(processed).toContain(undefined);
	});

	test('throws for non-positive concurrency values', async () => {
		await expect(forEachConcurrent([], 0, async () => {})).rejects.toThrow(RangeError);
		await expect(forEachConcurrent([], -1, async () => {})).rejects.toThrow(RangeError);
		await expect(forEachConcurrent([], 1.5, async () => {})).rejects.toThrow(RangeError);
	});

});
