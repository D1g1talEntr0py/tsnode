import process from 'node:process';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { transpileModule, ScriptTarget, ModuleKind, version as typescriptVersion } from 'typescript';
import type { ResolveHookSync, LoadHookSync, ResolveFnOutput, LoadFnOutput } from 'node:module';

type StatInfo = { mtimeMs: number; ctimeMs: number; ino: number; size: number };

const cacheDir = resolvePath(homedir(), '.cache', 'tsnode', typescriptVersion);
mkdirSync(cacheDir, { recursive: true });
const transpileTarget = ScriptTarget.ES2022;
const loaderCacheVersion = 'target-es2022';
const cachedEntries = new Set<string>();
const cacheVersion = `${process.versions.node}-${typescriptVersion}-${loaderCacheVersion}`;
const resolveCache = new Map<string, ResolveFnOutput>();
const statCache = new Map<string, StatInfo>();
const pathHashCache = new Map<string, string>();
const projectRootCache = new Map<string, string>();
const pendingCacheWrites = new Map<string, Promise<void>>();
let cacheWriteSequence = 0;

function clearLoaderCaches(): void {
	cachedEntries.clear();
	resolveCache.clear();
	statCache.clear();
	pathHashCache.clear();
	projectRootCache.clear();
}

async function flushPendingCacheWrites(): Promise<void> {
	const writes = [...pendingCacheWrites.values()];
	if (writes.length === 0) { return }

	await Promise.allSettled(writes);
}

export const loaderLifecycle = {
	[Symbol.dispose](): void {
		clearLoaderCaches();
	},
	async [Symbol.asyncDispose](): Promise<void> {
		await flushPendingCacheWrites();
		clearLoaderCaches();
	}
};

function hashPath(path: string): string {
	const cached = pathHashCache.get(path);
	if (cached !== undefined) { return cached }

	const hash = createHash('sha256').update(path).digest('hex').slice(0, 16);
	pathHashCache.set(path, hash);

	return hash;
}

function getStat(path: string): StatInfo | undefined {
	const cached = statCache.get(path);
	if (cached !== undefined) { return cached }

	const stat = statSync(path, { throwIfNoEntry: false });
	if (stat === undefined || !stat.isFile()) { return undefined }

	const info: StatInfo = { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, size: stat.size };
	statCache.set(path, info);

	return info;
}

function fileExists(path: string): boolean {
	return getStat(path) !== undefined;
}

function scheduleCacheWrite(cacheFileName: string, cachePath: string, source: string): void {
	if (cachedEntries.has(cacheFileName) || pendingCacheWrites.has(cacheFileName)) { return }

	const temporaryCachePath = cachePath + '.' + process.pid + '.' + cacheWriteSequence++ + '.tmp';
	const writePromise = writeFile(temporaryCachePath, source)
		.then(() => rename(temporaryCachePath, cachePath))
		.then(() => {
			cachedEntries.add(cacheFileName);
		})
		.catch(error => {
			rm(temporaryCachePath, { force: true }).catch(() => undefined);
			process.stderr.write('[tsnode] cache write failed: ' + String(error) + '\n');
		})
		.finally(() => {
			pendingCacheWrites.delete(cacheFileName);
		});

	pendingCacheWrites.set(cacheFileName, writePromise);
}

function directoryExists(path: string): boolean {
	const stat = statSync(path, { throwIfNoEntry: false });

	return stat !== undefined && stat.isDirectory();
}

function readCachedSource(cacheFileName: string, cachePath: string): string | undefined {
	try {
		const source = readFileSync(cachePath, 'utf8');
		cachedEntries.add(cacheFileName);

		return source;
	} catch (error) {
		const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
		cachedEntries.delete(cacheFileName);
		if (code !== 'ENOENT') {
			process.stderr.write('[tsnode] cache read failed: ' + String(error) + '\n');
		}

		return undefined;
	}
}

function findProjectRoot(startDirectory: string): string {
	const cached = projectRootCache.get(startDirectory);
	if (cached !== undefined) { return cached }

	let currentDirectory = startDirectory;
	for (;;) {
		if (fileExists(resolvePath(currentDirectory, 'tsconfig.json')) || fileExists(resolvePath(currentDirectory, 'package.json'))) {
			projectRootCache.set(startDirectory, currentDirectory);

			return currentDirectory;
		}

		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			const fallbackDirectory = process.cwd();
			projectRootCache.set(startDirectory, fallbackDirectory);

			return fallbackDirectory;
		}

		currentDirectory = parentDirectory;
	}
}

function resolveSrcRoot(parentURL?: string): string {
	if (parentURL !== undefined && parentURL.startsWith('file:')) {
		const parentDirectory = dirname(fileURLToPath(parentURL));
		const projectRoot = findProjectRoot(parentDirectory);
		const candidateSrcRoot = resolvePath(projectRoot, 'src');

		if (directoryExists(candidateSrcRoot)) { return candidateSrcRoot }
	}

	return resolvePath(process.cwd(), 'src');
}

function resolveTsPath(absPath: string): string | null {
	if (absPath.endsWith('.ts') && fileExists(absPath)) { return absPath }

	if (absPath.endsWith('.js')) {
		const tsPath = absPath.slice(0, -3) + '.ts';
		if (fileExists(tsPath)) { return tsPath }
	}

	const withTs = absPath + '.ts';
	if (fileExists(withTs)) { return withTs }

	const indexTs = absPath + '/index.ts';

	return fileExists(indexTs) ? indexTs : null;
}

export const resolve: ResolveHookSync = function(specifier, context, nextResolve): ResolveFnOutput {
	const firstChar = specifier.charCodeAt(0);
	const isRelative = firstChar === 46 /* . */;
	const isSrcAlias = firstChar === 115 /* s */ && specifier.startsWith('src/');
	if (!isRelative && !isSrcAlias) { return nextResolve(specifier, context) }

	const cacheKey = context.parentURL !== undefined ? specifier + '\0' + context.parentURL : specifier;
	const cached = resolveCache.get(cacheKey);
	if (cached !== undefined) { return cached }

	let absPath: string | null = null;
	if (isSrcAlias) {
		absPath = resolvePath(resolveSrcRoot(context.parentURL), specifier.slice(4));
	} else if (context.parentURL !== undefined && context.parentURL.startsWith('file:')) {
		absPath = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
	}

	if (absPath !== null) {
		const tsPath = resolveTsPath(absPath);
		if (tsPath !== null) {
			const result: ResolveFnOutput = { url: pathToFileURL(tsPath).href, format: 'module', shortCircuit: true };
			resolveCache.set(cacheKey, result);

			return result;
		}
	}

	return nextResolve(specifier, context);
};

export const load: LoadHookSync = function(url, context, nextLoad): LoadFnOutput {
	if (!url.startsWith('file:') || !url.endsWith('.ts')) { return nextLoad(url, context) }

	const path = fileURLToPath(url);
	const info = getStat(path);
	if (info === undefined) { return nextLoad(url, context) }

	const cacheFileName = hashPath(path) + '-' + info.mtimeMs + '-' + info.ctimeMs + '-' + info.ino + '-' + info.size + '-' + cacheVersion + '.js';
	const cachePath = resolvePath(cacheDir, cacheFileName);

	let source = readCachedSource(cacheFileName, cachePath);
	if (source === undefined) {
		const sourceCode = readFileSync(path, 'utf8');
		const result = transpileModule(sourceCode, {
			compilerOptions: {
				// Downlevel stage 3 decorators because current Node still can't execute
				// the syntax directly even though TypeScript can parse and type-check it.
				target: transpileTarget,
				module: ModuleKind.ESNext,
				jsx: undefined,
				declaration: false,
				sourceMap: false
			},
			reportDiagnostics: true
		});

		source = result.outputText;
		scheduleCacheWrite(cacheFileName, cachePath, source);
	}

	return { format: 'module', source, shortCircuit: true };
};

export async function disposeLoader(): Promise<void> {
	await loaderLifecycle[Symbol.asyncDispose]();
}
