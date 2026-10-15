import { fileURLToPath } from 'node:url';
import { parent } from '../utils/ipc/client';
import { ensureParsedTsconfig } from './initialize';
import { getTsconfigCacheKey } from '../utils/tsconfig';
import { encoding } from '../utils/constants';
import { logEsm as log, debugEnabled } from '../utils/debug';
import { transformSync, stripTypes } from '../utils/transform';
import { isJsonPattern, tsExtensionsPattern, fileUrlPrefix } from '../utils/path-utils';
import { getNamespace, namespaceQuery, canTryNativeTypeStripping } from './utils';
import type { CachedTransformOptions, HookData, Transformed } from '../types';
import type { LoadHookContext, LoadHookSync } from 'node:module';
import { Json } from '../utils/json';

type LoadResult = ReturnType<LoadHookSync> & { responseURL?: string };

const inlineSourceMapPrefix = '\n//# sourceMappingURL=data:application/json;base64,';

// Type-stripped results have no map: positions are preserved by whitespace
const toModuleSource = ({ code, map }: Transformed) => map ? code + inlineSourceMapPrefix + Buffer.from(Json.serialize(map), encoding).toString('base64') : code;
const isModuleTypeScriptFormat = (format: string | null | undefined) => format === 'module-typescript' || format === 'typescript';
const getTsconfigRaw = (hookData: HookData) => ensureParsedTsconfig(hookData);
const getTsconfigHash = (hookData: HookData) => {
	if (hookData.tsconfig === false) { return undefined }

	const parsed = getTsconfigRaw(hookData);

	return parsed ? getTsconfigCacheKey(hookData.tsconfig ?? process.env['TSNODE_TSCONFIG_PATH'], parsed) : 'missing-tsconfig';
};
const getFilePath = (url: string) => url.startsWith(fileUrlPrefix) ? fileURLToPath(url) : url;

// nextLoad() can return ArrayBuffer/TypedArray source; Node decodes text
// formats after the hook chain, but tsnode transforms before returning.
// https://github.com/nodejs/node/pull/55698
// https://github.com/nodejs/node/blob/v26.0.0/lib/internal/modules/customization_hooks.js#L374-L390
const decodeSource = (source: NonNullable<LoadResult['source']>) => typeof source === 'string' ? source : new TextDecoder().decode(source);
const hasDecorators = (code: string) => code.includes('@');
const nonErasableSyntaxPattern = /(?:^|[^\w$])(?:enum|namespace)\s+[\w$]/m;
const hasNonErasableSyntax = (code: string) => (code.includes('enum') || code.includes('namespace')) && nonErasableSyntaxPattern.test(code);
const needsClassFieldTransform = (code: string, hookData: HookData) => code.includes('class') && getTsconfigRaw(hookData)?.compilerOptions.useDefineForClassFields === false;
const getErrorCode = (error: unknown) => error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

const tryStripTypes = (code: string) => {
	try {
		return stripTypes(code);
	} catch (error) {
		if (getErrorCode(error) === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') { return }

		throw error;
	}
};

const notifyLoad = (hookData: HookData,	url: string) => {
	// URL parsing is only needed to strip the namespace query; skip it in
	// the common case where no namespace is present
	let cleanUrl = url;
	if (url.includes(namespaceQuery)) {
		const parsedUrl = new URL(url);
		parsedUrl.searchParams.delete('tsnode-namespace');
		cleanUrl = parsedUrl.toString();
	}

	hookData.onImport?.(cleanUrl);

	return cleanUrl;
};

/**
 * Prepares the import attributes for JSON modules, ensuring that the `type` attribute is set to `'json'` if applicable.
 * @param url The URL of the module being loaded.
 * @param context The context object provided by the loader.
 * @returns The modified context object with JSON attributes if applicable.
 */
const prepareJsonAttributes = (url: string, context: LoadHookContext) => {
	// Synchronous require() hooks receive undefined importAttributes despite the Node typings.
	if (isJsonPattern.test(url) && context.importAttributes?.type === undefined) {
		context.importAttributes = { ...context.importAttributes, type: 'json' };
	}

	return context;
};

export const createLoadSync = (hookData: HookData): LoadHookSync => {
	let transformOptions: CachedTransformOptions;

	/**
	 * Get the current transform options.
	 * @returns The current transform options.
	 */
	const getTransformOptions = () => {
		if (!transformOptions) {
			const configuration = getTsconfigRaw(hookData);
			const serialized = Json.serialize(configuration) ?? '';
			transformOptions = { tsconfigHash: getTsconfigHash(hookData), tsconfigSnapshot: { raw: configuration ? serialized : undefined, serialized } };
		}

		return transformOptions;
	};

	const load: LoadHookSync = (url,	context, nextLoad) => {
		if (!hookData.active || (hookData.namespace !== getNamespace(url))) { return nextLoad(url, context) }

		let virtualSource = hookData.virtualSources?.get(url);
		if (virtualSource === undefined && hookData.virtualSources && hookData.namespace) {
			const sourceUrl = new URL(url);
			sourceUrl.searchParams.delete('tsnode-namespace');
			virtualSource = hookData.virtualSources.get(sourceUrl.href);
		}

		if (virtualSource !== undefined) { return { format: 'module', source: virtualSource, shortCircuit: true } }

		// Keep this outside the optional send call: inlining notifyLoad in `path` would skip local onImport callbacks whenever parent IPC is disabled.
		const loadedUrl = notifyLoad(hookData, url);
		parent.send?.({ type: 'dependency', path: loadedUrl });

		const loaded = nextLoad(url, prepareJsonAttributes(url, context));

		log(3, 'loaded by next loader', { url, loaded });

		// Internal modules (e.g. node:*)
		if (!loaded.source) { return loaded }

		const pathname = url.startsWith(fileUrlPrefix) ? new URL(url).pathname : url;
		const isTypeScriptModule = isModuleTypeScriptFormat(loaded.format) || tsExtensionsPattern.test(pathname);
		const shouldTransformJson = loaded.format === 'json' && context.conditions?.includes('import') === true;

		if (!shouldTransformJson && !isTypeScriptModule) { return loaded }

		const code = decodeSource(loaded.source);

		if (isTypeScriptModule && canTryNativeTypeStripping(pathname) && !hasDecorators(code) && !hasNonErasableSyntax(code) && !needsClassFieldTransform(code, hookData)) {
			const stripped = tryStripTypes(code);
			if (stripped) { return { format: 'module', source: toModuleSource(stripped) } }
		}

		// Support named imports in JSON modules
		return shouldTransformJson || isTypeScriptModule ? { format: 'module', source: toModuleSource(transformSync(code, getFilePath(url), getTransformOptions())) } : loaded;
	};

	if (!debugEnabled) { return load }

	return (url, context, nextLoad) => {
		log(2, 'loadSync', { url, context });
		const result = load(url, context, nextLoad);
		log(1, 'loadedSync', { url, result });

		return result;
	};
};