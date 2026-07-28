import { fileURLToPath } from 'node:url';
import { parent } from '../utils/ipc/client';
import { logEsm as log, debugEnabled } from '../utils/debug';
import { ensureParsedTsconfig, type Data } from './initialize';
import { isJsonPattern, tsExtensionsPattern, fileUrlPrefix } from '../utils/path-utils';
import { transformSync, stripTypes, type Transformed } from '../utils/transform';
import { getTsconfigCacheKey } from '../utils/tsconfig';
import { getNamespace, namespaceQuery, canTryNativeTypeStripping } from './utils';

import type { LoadHook, LoadHookSync } from 'node:module';

type LoadResult = Awaited<ReturnType<LoadHook>> & {	responseURL?: string };

const inlineSourceMapPrefix = '\n//# sourceMappingURL=data:application/json;base64,';

// Type-stripped results have no map: positions are preserved by whitespace
const toModuleSource = ({ code, map }: Transformed) => map ? code + inlineSourceMapPrefix + Buffer.from(JSON.stringify(map), 'utf8').toString('base64') : code;
const isModuleTypeScriptFormat = (format: string | null | undefined) => format === 'module-typescript' || format === 'typescript';
const getTsconfigRaw = (hookData: Data) => ensureParsedTsconfig(hookData);
const getTsconfigHash = (hookData: Data) => hookData.tsconfig === false ? undefined : getTsconfigCacheKey(hookData.tsconfig ?? process.env['TSNODE_TSCONFIG_PATH']);
const getFilePath = (url: string) => url.startsWith(fileUrlPrefix) ? fileURLToPath(url) : url;

// nextLoad() can return ArrayBuffer/TypedArray source; Node decodes text
// formats after the hook chain, but tsnode transforms before returning.
// https://github.com/nodejs/node/pull/55698
// https://github.com/nodejs/node/blob/v26.0.0/lib/internal/modules/customization_hooks.js#L374-L390
const decodeSource = (source: NonNullable<LoadResult['source']>) => typeof source === 'string' ? source : new TextDecoder().decode(source);
const decoratorLinePattern = /^\s*@/m;
const hasDecorators = (code: string) => code.includes('@') && decoratorLinePattern.test(code);
const nonErasableSyntaxPattern = /(?:^|[^\w$])(?:enum|namespace)\s+[\w$]/m;
const hasNonErasableSyntax = (code: string) => (code.includes('enum') || code.includes('namespace')) && nonErasableSyntaxPattern.test(code);

const tryStripTypes = (code: string) => {
	try {
		return stripTypes(code);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
			return;
		}

		throw error;
	}
};

const notifyLoad = (hookData: Data,	url: string) => {
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

const prepareJsonAttributes = (url: string, context: Parameters<LoadHook>[1]) => {
	if (!isJsonPattern.test(url)) { return context }

	const contextAttributes = context.importAttributes;
	if (contextAttributes?.type) { return context }

	return { ...context, importAttributes: { ...contextAttributes, type: 'json' } };
};

export const createLoadSync = (hookData: Data): LoadHookSync => {
	const load: LoadHookSync = (url,	context, nextLoad) => {
		if (!hookData.active || (hookData.namespace !== getNamespace(url))) { return nextLoad(url, context) }

		const virtualSource = hookData.virtualSources?.get(url);
		if (virtualSource !== undefined) { return { format: 'module', source: virtualSource, shortCircuit: true } }

		if (hookData.onImport || parent.send) {
			parent.send?.({ type: 'dependency', path: notifyLoad(hookData, url) });
		}

		const loaded = nextLoad(url, prepareJsonAttributes(url, context));

		log(3, 'loaded by next loader', { url, loaded });

		// Internal modules (e.g. node:*)
		if (!loaded.source) { return loaded }

		const isTypeScriptModule = isModuleTypeScriptFormat(loaded.format) || tsExtensionsPattern.test(url);
		const shouldTransformJson = loaded.format === 'json' && context.conditions?.includes('import') === true;

		if (!shouldTransformJson && !isTypeScriptModule) { return loaded }

		const code = decodeSource(loaded.source);

		if (isTypeScriptModule && canTryNativeTypeStripping(url) && !hasDecorators(code) && !hasNonErasableSyntax(code)) {
			const stripped = tryStripTypes(code);
			if (stripped) { return { format: 'module', source: toModuleSource(stripped) } }
		}

		// Support named imports in JSON modules
		if (shouldTransformJson || isTypeScriptModule) {
			return { format: 'module', source: toModuleSource(transformSync(code, getFilePath(url), { tsconfigHash: getTsconfigHash(hookData), getTsconfigRaw: () => getTsconfigRaw(hookData) })) };
		}

		return loaded;
	};

	if (!debugEnabled) { return load }

	return (url, context, nextLoad) => {
		log(2, 'loadSync', { url, context });
		const result = load(url, context, nextLoad);
		log(1, 'loadedSync', { url, result });

		return result;
	};
};