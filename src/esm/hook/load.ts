import { fileURLToPath } from 'node:url';
import type { LoadHook, LoadHookSync } from 'node:module';
import type { TransformOptions } from 'esbuild';
import { isFileIncluded } from 'get-tsconfig';
import { transform, transformEsmSync } from '../../utils/transform/index.js';
import { transformDynamicImport } from '../../utils/transform/transform-dynamic-import.js';
import { inlineSourceMap } from '../../source-map.js';
import { isFeatureSupported, importAttributes } from '../../utils/node-features.js';
import { parent } from '../../utils/ipc/client.js';
import type { Message } from '../types.js';
import {
	isJsonPattern,
	tsExtensionsPattern,
	fileUrlPrefix,
} from '../../utils/path-utils.js';
import { logEsm as log, debugEnabled } from '../../utils/debug.js';
import { getNamespace } from './utils.js';
import type { Data } from './initialize.js';

const importAttributesProperty = (
	isFeatureSupported(importAttributes)
		? 'importAttributes'
		: 'importAssertions' as 'importAttributes'
);

const isModuleTypeScriptFormat = (
	format: string | null | undefined,
) => (
	format === 'module-typescript'
	|| format === 'typescript'
);

const getTsconfigRaw = (
	filePath: string,
	hookData: Data,
) => (
	hookData.parsedTsconfig && isFileIncluded(hookData.parsedTsconfig, filePath)
		? hookData.parsedTsconfig.config as TransformOptions['tsconfigRaw']
		: undefined
);

const getFilePath = (
	url: string,
) => (
	url.startsWith(fileUrlPrefix)
		? fileURLToPath(new URL(url))
		: url
);

type LoadResult = Awaited<ReturnType<LoadHook>> & {
	responseURL?: string;
};

// nextLoad() can return ArrayBuffer/TypedArray source; Node decodes text
// formats after the hook chain, but tsx transforms before returning.
// https://github.com/nodejs/node/pull/55698
// https://github.com/nodejs/node/blob/v26.0.0/lib/internal/modules/customization_hooks.js#L374-L390
const textDecoder = new TextDecoder();

const decodeSource = (
	source: NonNullable<LoadResult['source']>,
) => (
	typeof source === 'string'
		? source
		: textDecoder.decode(source)
);

const notifyLoad = (
	hookData: Data,
	url: string,
) => {
	const parsedUrl = new URL(url);
	parsedUrl.searchParams.delete('tsx-namespace');
	const cleanUrl = parsedUrl.toString();

	if (hookData.port) {
		hookData.port.postMessage({
			type: 'load',
			url: cleanUrl,
		} satisfies Message);
	}

	hookData.onImport?.(cleanUrl);

	return cleanUrl;
};

const prepareLoad = (
	hookData: Data,
	url: string,
) => {
	if (!hookData.active) {
		return false;
	}

	const urlNamespace = getNamespace(url);
	if (hookData.namespace && hookData.namespace !== urlNamespace) {
		return false;
	}

	const cleanUrl = notifyLoad(hookData, url);

	/*
	Filter out node:*
	Maybe only handle files that start with file://
	*/
	if (parent.send) {
		parent.send({
			type: 'dependency',
			path: cleanUrl,
		});
	}

	return true;
};

const prepareJsonAttributes = (
	url: string,
	context: Parameters<LoadHook>[1],
) => {
	if (!isJsonPattern.test(url)) {
		return context;
	}

	const contextAttributes = context[importAttributesProperty];
	if (contextAttributes?.type) {
		return context;
	}

	return {
		...context,
		[importAttributesProperty]: {
			...contextAttributes,
			type: 'json',
		},
	};
};

const isCommonJsRequireContext = (
	{ conditions }: Parameters<LoadHook>[1],
) => (
	conditions?.includes('require') === true
	&& !conditions.includes('import')
);

export const createLoad = (
	hookData: Data,
): LoadHook => {
	const load: LoadHook = async (
		url,
		context,
		nextLoad,
	) => {
		if (!prepareLoad(hookData, url)) {
			return nextLoad(url, context);
		}

		const filePath = getFilePath(url);
		const loadContext = prepareJsonAttributes(url, context);

		const loaded = await nextLoad(url, loadContext) as LoadResult;
		log(3, 'loaded by next loader', {
			url,
			loaded,
		});

		// CommonJS and Internal modules (e.g. node:*)
		if (!loaded.source) {
			return loaded;
		}

		const loadedFormat = loaded.format as string | undefined;
		const code = decodeSource(loaded.source);
		// CJS JSON require still parses hook source as JSON after module hooks.
		// https://github.com/nodejs/node/blob/v24.15.0/lib/internal/modules/cjs/loader.js#L1969-L1978
		const shouldTransformJson = loadedFormat === 'json' && !isCommonJsRequireContext(context);

		if (
			// Support named imports in JSON modules
			shouldTransformJson
			|| isModuleTypeScriptFormat(loadedFormat)
			|| tsExtensionsPattern.test(url)
		) {
			const transformed = await transform(
				code,
				filePath,
				{
					tsconfigRaw: getTsconfigRaw(filePath, hookData),
				},
			);

			return {
				format: 'module',
				source: inlineSourceMap(transformed),
			};
		}

		if (loaded.format === 'module') {
			const dynamicImportTransformed = transformDynamicImport(filePath, code);
			if (dynamicImportTransformed) {
				loaded.source = inlineSourceMap(dynamicImportTransformed);
			}
		}

		return loaded;
	};

	if (!debugEnabled) {
		return load;
	}

	return async (
		url,
		context,
		nextLoad,
	) => {
		log(2, 'load', {
			url,
			context,
		});
		const result = await load(url, context, nextLoad);
		log(1, 'loaded', {
			url,
			result,
		});
		return result;
	};
};

export const createLoadSync = (
	hookData: Data,
): LoadHookSync => {
	const load: LoadHookSync = (
		url,
		context,
		nextLoad,
	) => {
		if (!prepareLoad(hookData, url)) {
			return nextLoad(url, context);
		}

		const filePath = getFilePath(url);
		const loadContext = prepareJsonAttributes(url, context);

		const loaded = nextLoad(url, loadContext) as LoadResult;
		log(3, 'loaded by next loader', {
			url,
			loaded,
		});

		// CommonJS and Internal modules (e.g. node:*)
		if (!loaded.source) {
			return loaded;
		}

		const loadedFormat = loaded.format as string | undefined;
		const code = decodeSource(loaded.source);
		// CJS JSON require still parses hook source as JSON after module hooks.
		// https://github.com/nodejs/node/blob/v24.15.0/lib/internal/modules/cjs/loader.js#L1969-L1978
		const shouldTransformJson = loadedFormat === 'json' && !isCommonJsRequireContext(context);

		if (
			// Support named imports in JSON modules
			shouldTransformJson
			|| isModuleTypeScriptFormat(loadedFormat)
			|| tsExtensionsPattern.test(url)
		) {
			const transformed = transformEsmSync(
				code,
				filePath,
				{
					tsconfigRaw: getTsconfigRaw(filePath, hookData),
				},
			);

			return {
				format: 'module',
				source: inlineSourceMap(transformed),
			};
		}

		if (loaded.format === 'module') {
			const dynamicImportTransformed = transformDynamicImport(filePath, code);
			if (dynamicImportTransformed) {
				loaded.source = inlineSourceMap(dynamicImportTransformed);
			}
		}

		return loaded;
	};

	if (!debugEnabled) {
		return load;
	}

	return (
		url,
		context,
		nextLoad,
	) => {
		log(2, 'loadSync', {
			url,
			context,
		});
		const result = load(url, context, nextLoad);
		log(1, 'loadedSync', {
			url,
			result,
		});
		return result;
	};
};
