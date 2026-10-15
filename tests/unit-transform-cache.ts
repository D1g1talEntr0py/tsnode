import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { utimesSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	const mocked = {
		...actual,
		chmodSync: vi.fn(actual.chmodSync),
		existsSync: vi.fn(actual.existsSync),
		readFileSync: vi.fn(actual.readFileSync),
		writeFileSync: vi.fn(actual.writeFileSync),
		writeSync: vi.fn(actual.writeSync),
		renameSync: vi.fn(actual.renameSync),
	};
	return { ...mocked, default: mocked };
});

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		chmod: vi.fn(actual.chmod.bind(actual)),
		readFile: vi.fn(actual.readFile.bind(actual)),
		stat: vi.fn(actual.stat.bind(actual)),
	};
});

import cache, { forEachConcurrent } from '../src/utils/transform/cache';
import { tmpdir } from '../src/utils/temporary-directory';
import { Json } from '../src/utils/json';

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
		vi.restoreAllMocks();
		vi.resetAllMocks();
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

	test('rejects values whose toJSON returns undefined without retaining them', () => {
		const key = `undefined-json-${randomUUID()}`;
		const value = { code: 'export {}', toJSON: () => undefined };

		expect(() => cache.set(key, value)).toThrow('Cache value must serialize to JSON');
		expect(cache.has(key)).toBe(false);
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
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(value));
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
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(value));
	});

	test('ignores synchronous chmod failures while flushing cache entries', async () => {
		const key = `chmod-sync-failure-${randomUUID()}`;
		const value = { code: 'export const value = 1;' };
		const filePath = trackPath(cacheFilePath(key));
		const chmodSyncSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(((target: fs.PathLike | number) => {
			const fileName = String(target);
			if (fileName === cacheDirectory || fileName === filePath) {
				throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
			}
			return undefined as never;
		}) as typeof fs.chmodSync);

		cache.set(key, value);
		await settle();

		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(value));
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

	test('drains bounded pending batches without losing a synchronous 300-module wave', async () => {
		const keys = Array.from({ length: 300 }, () => `entry-bound-${randomUUID()}`);
		const paths = keys.map(key => trackPath(cacheFilePath(key)));
		for (const key of keys) {
			cache.set(key, { code: key });
		}
		for (const key of keys.slice(0, 236)) {
			expect(cache.has(key)).toBe(false);
		}
		expect(paths.filter(filePath => fs.existsSync(filePath))).toHaveLength(256);
		expect(cache.get(keys[299]!)).toEqual({ code: keys[299] });
		await settle();
		expect(paths.filter(filePath => fs.existsSync(filePath))).toHaveLength(300);
		cache.clear();
		for (const key of keys) {
			expect(cache.get(key)).toEqual({ code: key });
		}
	});

	test('avoids exception-driven cold misses after batch draining while reading published entries', async () => {
		const directory = trackPath(path.join(cacheDirectory, `cold-${randomUUID()}`));
		vi.resetModules();
		vi.doMock('../src/utils/temporary-directory', async (importOriginal) => ({
			...await importOriginal<typeof import('../src/utils/temporary-directory')>(),
			tmpdir: directory,
		}));
		try {
			const { default: coldCache } = await import('../src/utils/transform/cache');
			expect(coldCache.get('initial-miss')).toBeUndefined();
			for (let index = 0; index < 65; index += 1) {
				coldCache.set(`entry-${index}`, { code: `value-${index}` });
			}
			vi.mocked(fs.readFileSync).mockClear();
			expect(coldCache.get('later-miss')).toBeUndefined();
			expect(fs.readFileSync).not.toHaveBeenCalled();
			expect(coldCache.get('entry-0')).toEqual({ code: 'value-0' });
			fs.writeFileSync(path.join(directory, 'external'), Json.serialize({ code: 'external' })!);
			expect(coldCache.get('external')).toEqual({ code: 'external' });
			coldCache.clear();
			await settle();
			expect(vi.mocked(fsPromises.stat).mock.calls.some(([target]) => String(target).startsWith(directory))).toBe(false);
		} finally {
			vi.doUnmock('../src/utils/temporary-directory');
			vi.resetModules();
		}
	});

	test('does not add an existence probe to ordinary warm disk hits', () => {
		const key = `warm-probe-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		fs.writeFileSync(filePath, Json.serialize({ code: 'warm' })!);
		vi.mocked(fs.existsSync).mockClear();
		expect(cache.get(key)).toEqual({ code: 'warm' });
		expect(vi.mocked(fs.existsSync).mock.calls.some(([target]) => String(target) === filePath)).toBe(false);
	});

	test('bounds queued and memory payload bytes including multi-byte text and maps', async () => {
		const keys = Array.from({ length: 3 }, () => `byte-bound-${randomUUID()}`);
		const paths = keys.map(key => trackPath(cacheFilePath(key)));
		const value = {
			code: 'export {};',
			map: { version: 3, sources: [ 'large.ts' ], names: [], mappings: '', sourcesContent: [ '\u20ac'.repeat(1024 * 1024) ] },
		};
		for (const key of keys) {
			cache.set(key, value);
		}
		expect(cache.has(keys[0]!)).toBe(false);
		expect(cache.has(keys[1]!)).toBe(true);
		expect(cache.has(keys[2]!)).toBe(true);
		await settle();
		expect(paths.filter(filePath => fs.existsSync(filePath))).toHaveLength(3);
		cache.clear();
		expect(cache.get(keys[0]!)).toEqual(value);
	});

	test('does not retain or persist oversized entries, including replacements', async () => {
		const key = `oversized-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		cache.set(key, { code: 'small' });
		cache.set(key, { code: 'x'.repeat(8 * 1024 * 1024) });
		expect(cache.has(key)).toBe(false);
		expect(cache.get(key)).toBeUndefined();
		await settle();
		expect(fs.existsSync(filePath)).toBe(false);
	});

	test('counts the full request identity toward retention and publication bounds', async () => {
		const key = `oversized-identity-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		cache.set(key, { code: 'small', identity: ['\u20ac'.repeat(3 * 1024 * 1024), 'version'] });
		expect(cache.has(key)).toBe(false);
		await settle();
		expect(fs.existsSync(filePath)).toBe(false);
	});

	test('verifies escaped request identities in memory and on disk', async () => {
		const key = `verified-${randomUUID()}`;
		trackPath(cacheFilePath(key));
		const identity = ['source\n\"value\":{}', '\u20ac'];
		const different = ['other', identity[1]!];
		const value = { code: 'correct', identity };
		cache.set(key, value);
		expect(cache.get(key, identity)).toBe(value);
		expect(cache.get(key, different)).toBeUndefined();
		await settle();
		cache.clear();
		expect(await cache.getAsync(key, different)).toBeUndefined();
		expect(await cache.getAsync(key, identity)).toEqual(value);
	});

	test('clear resets byte accounting for subsequent queues', async () => {
		cache.set(`discard-${randomUUID()}`, { code: 'x'.repeat(7 * 1024 * 1024) });
		cache.clear();
		const key = `after-clear-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		const value = { code: 'x'.repeat(7 * 1024 * 1024) };
		cache.set(key, value);
		expect(cache.get(key)).toBe(value);
		await settle();
		expect(fs.existsSync(filePath)).toBe(true);
	});

	test('disabled cache bypasses every tier without retaining results', async () => {
		vi.resetModules();
		vi.stubEnv('TSNODE_DISABLE_CACHE', '1');
		try {
			const { default: disabledCache } = await import('../src/utils/transform/cache');
			const diskKey = `disabled-disk-${randomUUID()}`;
			const diskPath = trackPath(cacheFilePath(diskKey));
			fs.writeFileSync(diskPath, Json.serialize({ code: 'disk' })!);
			const prefix = `disabled-${randomUUID()}`;
			for (let index = 0; index < 2100; index += 1) {
				const key = `${prefix}-${index}`;
				expect(disabledCache.set(key, { code: key })).toBe(disabledCache);
				expect(disabledCache.has(key)).toBe(false);
				expect(disabledCache.get(key)).toBeUndefined();
			}
			expect(disabledCache.get(diskKey)).toBeUndefined();
			expect(await disabledCache.getAsync(diskKey)).toBeUndefined();
			disabledCache.clear();
			await settle();
			expect(fs.readdirSync(cacheDirectory).some(name => name.startsWith(prefix))).toBe(false);
		} finally {
			vi.unstubAllEnvs();
			vi.resetModules();
		}
	});

	test('publishes a complete private temp file by same-directory rename', async () => {
		const key = `atomic-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		const oldValue = { code: 'old' };
		const newValue = { code: 'new' };
		fs.writeFileSync(filePath, Json.serialize(oldValue)!, { mode: 0o644 });
		const { renameSync: originalRename } = await vi.importActual<typeof import('node:fs')>('node:fs');
		const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
			expect(String(destination)).toBe(filePath);
			expect(path.dirname(String(source))).toBe(cacheDirectory);
			expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(oldValue));
			expect(fs.readFileSync(source, 'utf-8')).toBe(Json.serialize(newValue));
			if (isPosix) { expect(fs.statSync(source).mode & 0o777).toBe(0o600) }
			originalRename(source, destination);
		});
		cache.set(key, newValue);
		await settle();
		expect(renameSpy).toHaveBeenCalledTimes(1);
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(newValue));
		expect(fs.readdirSync(cacheDirectory).filter(name => name.startsWith(`${key}.`))).toEqual([]);
	});

	test.each([ 'write', 'rename' ])('cleans temporary files after a %s failure without replacing published output', async failure => {
		const key = `atomic-failure-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		const oldValue = { code: 'old' };
		fs.writeFileSync(filePath, Json.serialize(oldValue)!);
		if (failure === 'write') {
			const { writeSync: originalWrite } = await vi.importActual<typeof import('node:fs')>('node:fs');
			vi.spyOn(fs, 'writeSync').mockImplementation((...args) => {
				originalWrite(...args);
				throw new Error('write failed after partial progress');
			});
		} else {
			vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename failed') });
		}
		cache.set(key, { code: 'new' });
		await settle();
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(oldValue));
		expect(fs.readdirSync(cacheDirectory).filter(name => name.startsWith(`${key}.`))).toEqual([]);
	});

	test('completes partial UTF-8 writes without splitting multibyte content', async () => {
		const key = `partial-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		const value = { code: '\u20ac'.repeat(100) };
		const { writeSync: originalWrite } = await vi.importActual<typeof import('node:fs')>('node:fs');
		vi.spyOn(fs, 'writeSync').mockImplementationOnce((descriptor, data) => {
			const buffer = Buffer.from(String(data), 'utf-8');
			return originalWrite(descriptor, buffer, 0, 17);
		});
		cache.set(key, value);
		await settle();
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(value));
	});

	test('expires old disk entries during maintenance', async () => {
		vi.resetModules();
		const { default: freshCache } = await import('../src/utils/transform/cache');
		const oldKey = `expired-${randomUUID()}`;
		const freshKey = `fresh-${randomUUID()}`;
		const oldPath = trackPath(cacheFilePath(oldKey));
		const freshPath = trackPath(cacheFilePath(freshKey));
		const oldValue = { code: 'export const oldValue = true;' };
		const freshValue = { code: 'export const freshValue = true;' };
		const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

		fs.writeFileSync(oldPath, Json.serialize(oldValue)!);
		fs.writeFileSync(freshPath, Json.serialize(freshValue)!);
		utimesSync(oldPath, oldTime, oldTime);

		expect(freshCache.get(freshKey)).toEqual(freshValue);
		await expect.poll(() => fs.existsSync(oldPath), { timeout: 1_000 }).toBe(false);
		expect(fs.existsSync(freshPath)).toBe(true);
		freshCache.clear();
	});

	test.each([ 'sync', 'async' ])('does not unlink a replacement after an interleaved corrupt %s read', async mode => {
		const key = `corrupt-race-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		const replacement = { code: 'replacement' };
		const corrupt = '{not json';
		fs.writeFileSync(filePath, corrupt);
		if (mode === 'sync') {
			const { readFileSync: originalRead } = await vi.importActual<typeof import('node:fs')>('node:fs');
			vi.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
				const contents = originalRead(...args);
				if (String(args[0]) === filePath) { fs.writeFileSync(filePath, Json.serialize(replacement)!) }
				return contents;
			});
			expect(cache.get(key)).toBeUndefined();
		} else {
			vi.mocked(fsPromises.readFile).mockImplementationOnce(async () => {
				fs.writeFileSync(filePath, Json.serialize(replacement)!);
				return corrupt;
			});
			expect(await cache.getAsync(key)).toBeUndefined();
		}
		await settle();
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(replacement));
		expect(cache.get(key)).toEqual(replacement);
	});

	test('reads disk entries directly without indexing the directory', () => {
		const key = `disk-${randomUUID()}`;
		const value = { code: 'export const value = 2;' };
		const filePath = trackPath(cacheFilePath(key));

		fs.writeFileSync(filePath, Json.serialize(value)!);

		expect(cache.get(key)).toEqual(value);
		expect(cache.has(key)).toBe(true);
	});

	test.each([ 'sync', 'async' ])('accounts for %s disk hits without re-serializing decoded results', async mode => {
		const key = `disk-bytes-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));
		const value = { code: '\u20ac'.repeat(1024), map: { version: 3, sources: [ 'source.ts' ], names: [], mappings: '' } };
		fs.writeFileSync(filePath, Json.serialize(value)!);
		const stringifySpy = vi.spyOn(Json, 'serialize');
		const result = mode === 'sync' ? cache.get(key) : await cache.getAsync(key);
		expect(stringifySpy).not.toHaveBeenCalled();
		stringifySpy.mockRestore();
		expect(result).toEqual(value);
		expect(cache.has(key)).toBe(true);
	});

	test('treats corrupted disk cache entries as non-destructive misses', async () => {
		const key = `broken-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));

		fs.writeFileSync(filePath, '{"broken": }');

		expect(cache.get(key)).toBeUndefined();

		await settle();
		expect(fs.existsSync(filePath)).toBe(true);
	});

	test('treats valid JSON with the wrong transform shape as a miss', async () => {
		const key = `wrong-shape-${randomUUID()}`;
		const filePath = trackPath(cacheFilePath(key));

		fs.writeFileSync(filePath, Json.serialize({ output: 'export {}' })!);

		expect(cache.get(key)).toBeUndefined();
		await settle();
		expect(fs.existsSync(filePath)).toBe(true);
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
		expect(fs.readFileSync(filePath, 'utf-8')).toBe(Json.serialize(replacement));
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
