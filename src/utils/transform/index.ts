import { createRequire, stripTypeScriptTypes } from 'node:module';
import { noop } from '../constants';
import path from 'node:path';
import cache from './cache';
import { cacheConfig, patchSourcefileOption, patchTransformResult } from './get-esbuild-options';
import type { CachedTransformOptions, Transformed } from '../../types';
import type { TransformOptions } from 'esbuild';
import { Json } from '../json';

type EsbuildModule = typeof import('esbuild');

type MutableTransformFailure = Error & {
	errors?: unknown[];
	warnings?: unknown[];
};

let loadModule: NodeJS.Require | undefined;

const getLoadModule = () => loadModule ?? (loadModule = createRequire(import.meta.url));

// Resolving esbuild's package.json costs ~1ms and is only needed once an esbuild transform actually happens, which the native-strip path never reaches.
let esbuildVersionSalt: string | undefined;

const getEsbuildVersionSalt = () => esbuildVersionSalt ?? (esbuildVersionSalt = `-${(getLoadModule()('esbuild/package.json') as { version: string }).version}`);

let esbuildModule: EsbuildModule | undefined;

const getEsbuildModuleSync = () => esbuildModule ?? (esbuildModule = getLoadModule()('esbuild') as EsbuildModule);

const isTransformFailure = (error: unknown): error is MutableTransformFailure => {
	if (error === null || typeof error !== 'object') { return false }

	return error instanceof Error && 'errors' in error && Array.isArray(error.errors) && 'warnings' in error && Array.isArray(error.warnings);
};

const bucket = (value: string) => {
	let hash = 2166136261;
	for (let index = 0, length = value.length; index < length; index += 1) {
		hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
	}
	return (hash >>> 0).toString(36);
};

// The stripper (amaro) ships with Node, so its output is tied to the Node version
const stripVersionSalt = `-strip-${process.versions.node}`;

const stripTypeScriptTypesQuietly = (code: string) => {
	const emitWarning = process.emitWarning;
	process.emitWarning = noop;

	try {
		return stripTypeScriptTypes(code, { mode: 'strip' });
	} finally {
		process.emitWarning = emitWarning;
	}
};

/**
 * Type stripping via Node's built-in stripper. Output is disk-cached so
 * warm runs skip amaro's WASM initialization entirely. Output doesn't
 * depend on the file path (no source map is generated), so the hash
 * doesn't include it, deduplicating identical sources.
 * @param code The TypeScript source code to strip.
 * @returns The stripped code.
 */
export const stripTypes = (code: string): Transformed => {
	const hash = `v3-${bucket(code)}${stripVersionSalt}`;
	const identity = [ code, stripVersionSalt ];
	let stripped = cache.get(hash, identity);

	if (!Array.isArray(stripped?.identity) || stripped.identity.length !== 2 || stripped.identity[0] !== code || stripped.identity[1] !== stripVersionSalt) {
		stripped = { code: stripTypeScriptTypesQuietly(code), identity };
		cache.set(hash, stripped);
	}

	return stripped;
};

const getPathname = (value: string) => {
	const queryIndex = value.indexOf('?');

	return queryIndex === -1 ? value : value.slice(0, queryIndex);
};

const needsSourcefilePatch = (sourcefile: string | undefined) => !sourcefile ? false : path.extname(getPathname(sourcefile)).length === 0;

let defaultOptionsIdentity: string | undefined;

const getCustomOptionsIdentity = (options: TransformOptions) => {
	let cacheable = true;
	const expressionIdentity = (value: RegExp | undefined) => value instanceof RegExp ? [value.source, value.flags] : undefined;
	const identity = Json.serialize([ options, Object.keys(options), expressionIdentity(options.mangleProps), expressionIdentity(options.reserveProps) ], function (this: unknown, key: string, value: unknown) {
		const original: unknown = (this as Record<string, unknown>)[key];

		if (typeof original === 'function' || typeof original === 'symbol') { cacheable = false }

		if (original !== null && typeof original === 'object') {
			const prototype: unknown = Object.getPrototypeOf(original);
			const supportedExpression = original instanceof RegExp && (original === options.mangleProps || original === options.reserveProps);
			if ((!Array.isArray(original) && prototype !== Object.prototype && prototype !== null && !supportedExpression) || typeof Reflect.get(original, 'toJSON') === 'function') { cacheable = false }
		}

		return value;
	});

	return cacheable ? identity : undefined;
};

export const transformSync = (code: string, filePath: string, extendOptions?: CachedTransformOptions): Transformed => {
	const { tsconfigHash, getTsconfigRaw, tsconfigSnapshot, ...esbuildExtendOptions } = extendOptions ?? {};
	const esbuildOptions: TransformOptions = { ...cacheConfig, format: 'esm', sourcefile: filePath, ...esbuildExtendOptions };
	const originalSourcefile = needsSourcefilePatch(esbuildOptions.sourcefile) ? patchSourcefileOption(esbuildOptions) : esbuildOptions.sourcefile;
	const snapshot = esbuildOptions.tsconfigRaw === undefined ? tsconfigSnapshot : undefined;

	if ((snapshot || getTsconfigRaw) && esbuildOptions.tsconfigRaw === undefined) {
		const tsconfigRaw = snapshot ? snapshot.raw : getTsconfigRaw!();
		if (tsconfigRaw !== undefined) { esbuildOptions.tsconfigRaw = tsconfigRaw }
	}

	const customOptions = Object.keys(esbuildExtendOptions).some(option => option !== 'sourcefile' && option !== 'tsconfigRaw') || (!snapshot && esbuildOptions.tsconfigRaw !== undefined);
	const optionsIdentity = customOptions ? getCustomOptionsIdentity(esbuildOptions) : defaultOptionsIdentity ??= Json.serialize({ ...cacheConfig, format: 'esm' });
	const compilerIdentity = snapshot && !customOptions ? snapshot.identity ??= Json.serialize([optionsIdentity, tsconfigHash ?? '', snapshot.serialized, getEsbuildVersionSalt()]) : Json.serialize([optionsIdentity, tsconfigHash ?? '', snapshot?.serialized ?? Json.serialize(esbuildOptions.tsconfigRaw) ?? '', getEsbuildVersionSalt()]);
	const identity = `[${Json.serialize(code)},${Json.serialize({ filePath, sourcefile: esbuildOptions.sourcefile, originalSourcefile: originalSourcefile === esbuildOptions.sourcefile ? undefined : originalSourcefile })},${compilerIdentity}]`;
	const hash = `v3-${bucket(code)}-${bucket(filePath)}`;
	let transformed = optionsIdentity === undefined ? undefined : cache.get(hash, identity);

	if (transformed?.identity !== identity) {
		let result;

		try {
			result = getEsbuildModuleSync().transformSync(code, esbuildOptions);
		} catch (error) {
			if (isTransformFailure(error)) {
				error.name = 'TransformError';
				delete error.errors;
				delete error.warnings;
			}

			throw error;
		}

		// If the sourcefile has no extension, esbuild doesn't generate a source map, so we patch it in to preserve positions
		transformed = Boolean(esbuildOptions.sourcemap) || originalSourcefile !== esbuildOptions.sourcefile ? patchTransformResult(result, esbuildOptions.sourcefile, originalSourcefile) : { code: result.code };
		transformed = { ...transformed, identity };

		if (optionsIdentity !== undefined) { cache.set(hash, transformed) }
	}

	return transformed;
};
