import {
	transform as esbuildTransform,
	transformSync as esbuildTransformSync,
	version as esbuildVersion,
	type TransformOptions,
	type TransformFailure,
} from 'esbuild';
import { sha1 } from '../sha1.js';
import {
	version as transformDynamicImportVersion,
	transformDynamicImport,
} from './transform-dynamic-import.js';
import cache from './cache.js';
import {
	applyTransformersSync,
	applyTransformers,
	type Transformed,
} from './apply-transformers.js';
import {
	cacheConfig,
	patchOptions,
} from './get-esbuild-options.js';

const formatEsbuildError = (
	error: TransformFailure,
) => {
	error.name = 'TransformError';
	// @ts-expect-error deleting non-option property
	delete error.errors;
	// @ts-expect-error deleting non-option property
	delete error.warnings;
	throw error;
};

/**
 * tsconfigRaw is a stable object reference per project but can be large;
 * cache its serialization instead of re-stringifying per transformed file
 */
const stringifyCache = new WeakMap<object, string>();

const stringifyStable = (value: unknown) => {
	if (value && typeof value === 'object') {
		let cached = stringifyCache.get(value);
		if (cached === undefined) {
			cached = JSON.stringify(value);
			stringifyCache.set(value, cached);
		}
		return cached;
	}
	return JSON.stringify(value) ?? '';
};

const versionSuffix = `-${esbuildVersion}-${transformDynamicImportVersion}`;

const getHash = (
	code: string,
	filePath: string,
	esbuildOptions: TransformOptions,
) => {
	const { tsconfigRaw, ...staticOptions } = esbuildOptions;
	return sha1([
		code,
		filePath,
		JSON.stringify(staticOptions),
		stringifyStable(tsconfigRaw),
		versionSuffix,
	].join('-'));
};

export const transform = async (
	code: string,
	filePath: string,
	extendOptions?: TransformOptions,
): Promise<Transformed> => {
	const esbuildOptions = {
		...cacheConfig,
		format: 'esm',
		sourcefile: filePath,
		...extendOptions,
	} as const;

	const hash = getHash(code, filePath, esbuildOptions);
	let transformed = cache.get(hash);

	if (!transformed) {
		transformed = await applyTransformers(
			filePath,
			code,
			[
				async (_filePath, _code) => {
					const patchResult = patchOptions(esbuildOptions);
					let result;
					try {
						result = await esbuildTransform(_code, esbuildOptions);
					} catch (error) {
						throw formatEsbuildError(error as TransformFailure);
					}
					return patchResult(result);
				},
				(_filePath, _code) => transformDynamicImport(_filePath, _code, true),
			],
		);

		cache.set(hash, transformed);
	}

	return transformed;
};

export const transformEsmSync = (
	code: string,
	filePath: string,
	extendOptions?: TransformOptions,
): Transformed => {
	const esbuildOptions = {
		...cacheConfig,
		format: 'esm',
		sourcefile: filePath,
		...extendOptions,
	} as const;

	const hash = getHash(code, filePath, esbuildOptions);
	let transformed = cache.get(hash);

	if (!transformed) {
		transformed = applyTransformersSync(
			filePath,
			code,
			[
				(_filePath, _code) => {
					const patchResult = patchOptions(esbuildOptions);
					let result;
					try {
						result = esbuildTransformSync(_code, esbuildOptions);
					} catch (error) {
						throw formatEsbuildError(error as TransformFailure);
					}
					return patchResult(result);
				},
				(_filePath, _code) => transformDynamicImport(_filePath, _code, true),
			],
		);

		cache.set(hash, transformed);
	}

	return transformed;
};
