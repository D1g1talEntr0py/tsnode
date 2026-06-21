import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { version as typescriptVersion } from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { writeFileMock } = vi.hoisted(() => ({
	writeFileMock: vi.fn()
}));

vi.mock('node:fs/promises', async importOriginal => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();

	return {
		...actual,
		writeFile: writeFileMock
	};
});

let resolveHook: typeof import('../src/hooks.js').resolve;
let loadHook: typeof import('../src/hooks.js').load;
let disposeLoaderHook: typeof import('../src/hooks.js').disposeLoader;
let temporaryHome = '';
let originalHome = '';

async function flushAsyncCacheWrite(): Promise<void> {
	await new Promise<void>(resolve => {
		setImmediate(resolve);
	});
}

function toFinalCachePath(temporaryCachePath: string): string {
	return temporaryCachePath.replace(/\.\d+\.\d+\.tmp$/, '');
}

async function waitForCacheFile(cachePath: string): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (existsSync(cachePath)) { return }
		await new Promise<void>(resolve => {
			setTimeout(resolve, 0);
		});
	}

	throw new Error('Timed out waiting for cache file: ' + cachePath);
}

beforeAll(async () => {
	temporaryHome = mkdtempSync(join(tmpdir(), 'tsnode-home-'));
	originalHome = process.env.HOME ?? '';
	process.env.HOME = temporaryHome;

	const hooksModule = await import('../src/hooks.js?vitest-hooks');
	resolveHook = hooksModule.resolve;
	loadHook = hooksModule.load;
	disposeLoaderHook = hooksModule.disposeLoader;
});

afterAll(() => {
	if (originalHome.length > 0) {
		process.env.HOME = originalHome;
	} else {
		delete process.env.HOME;
	}

	rmSync(temporaryHome, { recursive: true, force: true });
});

beforeEach(() => {
	writeFileMock.mockReset();
	writeFileMock.mockImplementation(async (path, data) => {
		writeFileSync(String(path), String(data));
	});
});

describe('resolve hook', () => {
	it('resolves relative .js specifiers to local .ts files', () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'tsnode-resolve-relative-'));
		const targetTsFile = join(fixtureDir, 'helper.ts');
		writeFileSync(targetTsFile, 'export const value = 1;\n');

		const nextResolve = vi.fn(() => ({ url: 'next://value', format: 'module' as const }));
		const result = resolveHook(
			'./helper.js',
			{ parentURL: pathToFileURL(join(fixtureDir, 'entry.ts')).href } as Parameters<typeof resolveHook>[1],
			nextResolve
		);

		expect(result.url).toBe(pathToFileURL(targetTsFile).href);
		expect(result.shortCircuit).toBe(true);
		expect(nextResolve).not.toHaveBeenCalled();

		rmSync(fixtureDir, { recursive: true, force: true });
	});

	it('resolves src/ aliases from discovered project root', () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'tsnode-resolve-src-'));
		writeFileSync(join(projectRoot, 'package.json'), '{"name":"fixture"}\n');
		mkdirSync(join(projectRoot, 'src'), { recursive: true });
		mkdirSync(join(projectRoot, 'nested'), { recursive: true });
		const targetTsFile = join(projectRoot, 'src', 'library.ts');
		writeFileSync(targetTsFile, 'export const value = 2;\n');

		const nextResolve = vi.fn(() => ({ url: 'next://value', format: 'module' as const }));
		const result = resolveHook(
			'src/library',
			{ parentURL: pathToFileURL(join(projectRoot, 'nested', 'entry.ts')).href } as Parameters<typeof resolveHook>[1],
			nextResolve
		);

		expect(result.url).toBe(pathToFileURL(targetTsFile).href);
		expect(result.shortCircuit).toBe(true);
		expect(nextResolve).not.toHaveBeenCalled();

		rmSync(projectRoot, { recursive: true, force: true });
	});

	it('delegates unresolved imports to nextResolve', () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'tsnode-resolve-fallback-'));
		const sentinel = { url: 'next://fallback', format: 'commonjs' as const };
		const nextResolve = vi.fn(() => sentinel);

		const result = resolveHook(
			'./missing.js',
			{ parentURL: pathToFileURL(join(fixtureDir, 'entry.ts')).href } as Parameters<typeof resolveHook>[1],
			nextResolve
		);

		expect(result).toBe(sentinel);
		expect(nextResolve).toHaveBeenCalledTimes(1);

		rmSync(fixtureDir, { recursive: true, force: true });
	});
});

describe('load hook', () => {
	it('transpiles .ts files to executable JavaScript', () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'tsnode-load-transpile-'));
		const inputTsFile = join(fixtureDir, 'module.ts');
		writeFileSync(inputTsFile, 'export const answer: number = 42;\n');

		const nextLoad = vi.fn(() => ({ format: 'module' as const, source: '' }));
		const result = loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		expect(result.format).toBe('module');
		expect(result.shortCircuit).toBe(true);
		expect(String(result.source)).toContain('export const answer = 42;');
		expect(nextLoad).not.toHaveBeenCalled();

		rmSync(fixtureDir, { recursive: true, force: true });
	});

	it('queues cache writes without blocking repeated loads', async () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'tsnode-load-queue-'));
		const inputTsFile = join(fixtureDir, 'module.ts');
		writeFileSync(inputTsFile, 'export const answer: number = 42;\n');

		let releaseWrite: () => void = () => {};
		const pendingWrite = new Promise<void>(resolve => {
			releaseWrite = resolve;
		});
		writeFileMock.mockImplementationOnce(async (path, data) => {
			await pendingWrite;
			writeFileSync(String(path), String(data));
		});

		const nextLoad = vi.fn(() => ({ format: 'module' as const, source: '' }));
		const firstResult = loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);
		const secondResult = loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		expect(writeFileMock).toHaveBeenCalledTimes(1);
		expect(nextLoad).not.toHaveBeenCalled();
		expect(String(firstResult.source)).toContain('export const answer = 42;');
		expect(String(secondResult.source)).toContain('export const answer = 42;');

		releaseWrite();
		await flushAsyncCacheWrite();

		rmSync(fixtureDir, { recursive: true, force: true });
	});

	it('reuses an existing on-disk cache entry on later loads', async () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'tsnode-load-cache-hit-'));
		const inputTsFile = join(fixtureDir, 'module.ts');
		writeFileSync(inputTsFile, 'export const answer: number = 42;\n');

		const nextLoad = vi.fn(() => ({ format: 'module' as const, source: '' }));
		const firstResult = loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		expect(writeFileMock).toHaveBeenCalledTimes(1);

		const cachePath = toFinalCachePath(String(writeFileMock.mock.calls[0]?.[0]));
		await waitForCacheFile(cachePath);
		await flushAsyncCacheWrite();

		writeFileMock.mockClear();

		const secondResult = loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		expect(writeFileMock).not.toHaveBeenCalled();
		expect(String(secondResult.source)).toBe(String(firstResult.source));

		rmSync(fixtureDir, { recursive: true, force: true });
	});

	it('falls back to retranspile when a known cache entry is missing', async () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'tsnode-load-cache-miss-'));
		const inputTsFile = join(fixtureDir, 'module.ts');
		writeFileSync(inputTsFile, 'export const answer: number = 42;\n');

		const nextLoad = vi.fn(() => ({ format: 'module' as const, source: '' }));
		const firstResult = loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		expect(writeFileMock).toHaveBeenCalledTimes(1);

		const cacheDirectory = join(temporaryHome, '.cache', 'tsnode', typescriptVersion);
		const cachePath = toFinalCachePath(String(writeFileMock.mock.calls[0]?.[0]));
		await waitForCacheFile(cachePath);
		await flushAsyncCacheWrite();
		rmSync(cacheDirectory, { recursive: true, force: true });
		mkdirSync(cacheDirectory, { recursive: true });

		writeFileMock.mockClear();

		const secondResult = loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		expect(writeFileMock).toHaveBeenCalledTimes(1);
		expect(String(secondResult.source)).toBe(String(firstResult.source));

		rmSync(fixtureDir, { recursive: true, force: true });
	});

	it('delegates non-TypeScript urls to nextLoad', () => {
		const sentinel = { format: 'module' as const, source: 'pass-through' };
		const nextLoad = vi.fn(() => sentinel);

		const result = loadHook(
			'file:///tmp/example.js',
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		expect(result).toBe(sentinel);
		expect(nextLoad).toHaveBeenCalledTimes(1);
	});

	it('disposeLoader waits for in-flight cache writes to settle', async () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'tsnode-dispose-'));
		const inputTsFile = join(fixtureDir, 'module.ts');
		writeFileSync(inputTsFile, 'export const answer: number = 42;\n');

		let releaseWrite: () => void = () => {};
		const pendingWrite = new Promise<void>(resolve => {
			releaseWrite = resolve;
		});
		writeFileMock.mockImplementationOnce(async (path, data) => {
			await pendingWrite;
			writeFileSync(String(path), String(data));
		});

		const nextLoad = vi.fn(() => ({ format: 'module' as const, source: '' }));
		loadHook(
			pathToFileURL(inputTsFile).href,
			{} as Parameters<typeof loadHook>[1],
			nextLoad
		);

		const disposePromise = disposeLoaderHook();

		releaseWrite();
		await disposePromise;

		rmSync(fixtureDir, { recursive: true, force: true });
	});
});
