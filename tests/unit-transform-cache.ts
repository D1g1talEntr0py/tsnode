import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import cache, { forEachConcurrent } from '../src/utils/transform/cache';
import { tmpdir } from '../src/utils/temporary-directory';

const cacheDirectory = tmpdir;
const markerPath = path.join(cacheDirectory, '.last-sweep');

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

	test('names cache files by key alone', async () => {
		const key = `named-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));

		cache.set(key, { code: 'export const value = 1;' });
		await settle();

		expect(fs.existsSync(filePath)).toBe(true);
		expect(path.basename(filePath)).toBe(key);
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

		// Unlink is fire-and-forget; give it a turn to land.
		await settle();
		expect(fs.existsSync(filePath)).toBe(false);
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

	test('throws for non-positive concurrency values', async () => {
		await expect(forEachConcurrent([], 0, async () => {})).rejects.toThrow(RangeError);
		await expect(forEachConcurrent([], -1, async () => {})).rejects.toThrow(RangeError);
		await expect(forEachConcurrent([], 1.5, async () => {})).rejects.toThrow(RangeError);
	});
});
