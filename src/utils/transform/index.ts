import { createRequire, stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import cache from './cache';
import { cacheConfig, patchSourcefileOption, patchTransformResult, type SourceMap } from './get-esbuild-options';
import type { TransformOptions, TransformFailure } from 'esbuild';

type CachedTransformOptions = TransformOptions & {
	tsconfigHash?: string;
	getTsconfigRaw?: () => TransformOptions['tsconfigRaw'];
};

type EsbuildModule = typeof import('esbuild');

export type Transformed = {
	code: string;
	// Absent for natively type-stripped results: stripping replaces types with whitespace, so positions are preserved and no map is needed
	map?: SourceMap;
};

let loadModule: NodeJS.Require | undefined;

const getLoadModule = () => loadModule ?? (loadModule = createRequire(import.meta.url));

// Resolving esbuild's package.json costs ~1ms and is only needed once an esbuild transform actually happens, which the native-strip path never reaches.
let esbuildVersionSalt: string | undefined;

const getEsbuildVersionSalt = () => esbuildVersionSalt ?? (esbuildVersionSalt = `-${(getLoadModule()('esbuild/package.json') as { version: string }).version}`);

let esbuildModule: EsbuildModule | undefined;

const getEsbuildModuleSync = () => esbuildModule ?? (esbuildModule = getLoadModule()('esbuild'));

const formatEsbuildError = (error: TransformFailure) => {
	error.name = 'TransformError';
	// @ts-expect-error deleting non-option property
	delete error.errors;
	// @ts-expect-error deleting non-option property
	delete error.warnings;

	throw error;
};

// tsconfigRaw is a stable object reference per project but can be large; cache its serialization instead of re-stringifying per transformed file
const stringifyCache = new WeakMap<object, string>();

const stringifyStable = (value: unknown) => {
	if (value && typeof value === 'object') {
		let cached = stringifyCache.get(value);

		if (cached !== undefined) { return cached }

		cached = JSON.stringify(value);
		stringifyCache.set(value, cached);

		return cached;
	}

	return JSON.stringify(value) ?? '';
};

// Fast non-crypto hash for cache keys. We only need stable bucketing, not collision resistance.
const hashString = (hashSeed: number, data: string) => {
	let hash = hashSeed;
	for (let index = 0, length = data.length; index < length; index += 1) {
		// hash ^= data.charCodeAt(index);
		hash = Math.imul(hash ^ data.charCodeAt(index), 0x01000193);
	}

	return hash;
};

const hashSeparator = '\0';
const fastHashPair = (part1: string, part2: string) => {
	let hash = 0x811c9dc5;
	hash = hashString(hash, part1);
	hash = hashString(hash, hashSeparator);
	hash = hashString(hash, part2);

	return (hash >>> 0).toString(16);
};
const fastHashParts = (part1: string, part2: string, part3: string, part4: string, part5: string) => {
	let hash = 0x811c9dc5;
	hash = hashString(hash, part1);
	hash = hashString(hash, hashSeparator);
	hash = hashString(hash, part2);
	hash = hashString(hash, hashSeparator);
	hash = hashString(hash, part3);
	hash = hashString(hash, hashSeparator);
	hash = hashString(hash, part4);
	hash = hashString(hash, hashSeparator);
	hash = hashString(hash, part5);

	return (hash >>> 0).toString(16);
};

const baseHashOptions = stringifyStable({ ...cacheConfig, format: 'esm' });

// The stripper (amaro) ships with Node, so its output is tied to the Node version
const stripVersionSalt = `-strip-${process.versions.node}`;

/**
 * Type stripping via Node's built-in stripper. Output is disk-cached so
 * warm runs skip amaro's WASM initialization entirely. Output doesn't
 * depend on the file path (no source map is generated), so the hash
 * doesn't include it, deduplicating identical sources.
 */
export const stripTypes = (code: string): Transformed => {
	const hash = fastHashPair(code, stripVersionSalt);
	let stripped = cache.get(hash);

	if (!stripped) {
		stripped = { code: stripTypeScriptTypes(code, { mode: 'strip' }) };
		cache.set(hash, stripped);
	}

	return stripped;
};

const hasCustomHashOptions = (extendOptions: TransformOptions | undefined) => {
	if (!extendOptions) { return false }

	for (const optionName in extendOptions) {
		if (optionName !== 'sourcefile' && optionName !== 'tsconfigRaw' && optionName !== 'tsconfigHash' && optionName !== 'getTsconfigRaw') { return true }
	}

	return false;
};

const getHash = (
	code: string,
	filePath: string,
	options: TransformOptions,
	versionSalt: string,
	hashOptionsString: string,
	tsconfigHash: string | undefined,
) => fastHashParts(code, filePath, hashOptionsString, tsconfigHash ?? stringifyStable(options.tsconfigRaw), versionSalt);

const getPathname = (value: string) => {
	const queryIndex = value.indexOf('?');

	return queryIndex === -1 ? value : value.slice(0, queryIndex);
};

const needsSourcefilePatch = (sourcefile: string | undefined) => !sourcefile ? false : path.extname(getPathname(sourcefile)).length === 0;

export const transformSync = (code: string, filePath: string, extendOptions?: CachedTransformOptions): Transformed => {
	const { tsconfigHash, getTsconfigRaw, ...esbuildExtendOptions } = extendOptions ?? {};
	const esbuildOptions = { ...cacheConfig, format: 'esm', sourcefile: filePath, ...esbuildExtendOptions } as TransformOptions;
	const originalSourcefile = needsSourcefilePatch(esbuildOptions.sourcefile) ? patchSourcefileOption(esbuildOptions) : esbuildOptions.sourcefile;

	// Only call getTsconfigRaw now if tsconfigHash is absent — we need tsconfigRaw to compute the hash.
	// When tsconfigHash is provided it stands in for the tsconfig content in the hash, so we can
	// defer the (potentially expensive) getTsconfigRaw call until we confirm a cache miss.
	if (getTsconfigRaw && esbuildOptions.tsconfigRaw === undefined && !tsconfigHash) { esbuildOptions.tsconfigRaw = getTsconfigRaw() }

	const hashOptionsString = hasCustomHashOptions(extendOptions) ? stringifyStable({ ...esbuildOptions, sourcefile: undefined, tsconfigRaw: undefined }) : baseHashOptions;

	const hash = getHash(code, filePath, esbuildOptions, getEsbuildVersionSalt(), hashOptionsString, tsconfigHash);
	let transformed = cache.get(hash);

	if (!transformed) {
		// Cache miss — call getTsconfigRaw if it was deferred above
		if (getTsconfigRaw && esbuildOptions.tsconfigRaw === undefined) { esbuildOptions.tsconfigRaw = getTsconfigRaw() }

		let result;

		try {
			result = getEsbuildModuleSync().transformSync(code, esbuildOptions);
		} catch (error) {
			throw formatEsbuildError(error as TransformFailure);
		}

		// If the sourcefile has no extension, esbuild doesn't generate a source map, so we patch it in to preserve positions
		transformed = Boolean(esbuildOptions.sourcemap) || originalSourcefile !== esbuildOptions.sourcefile ? patchTransformResult(result, esbuildOptions.sourcefile, originalSourcefile) : { code: result.code };

		cache.set(hash, transformed);
	}

	return transformed;
};
