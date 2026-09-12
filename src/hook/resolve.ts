import { pathToFileURL } from 'node:url';
import { extname, posix, sep } from 'node:path';
import { resolveTsconfigPaths } from '../utils/tsconfig';
import { logEsm as log, debugEnabled } from '../utils/debug';
import { ensureParsedTsconfig } from './initialize';
import { getFormatFromFileUrl, namespaceQuery, getNamespace } from './utils';
import { fileUrlPrefix, nodeModulesPath, tsExtensionsPattern, isDirectoryPattern, isRelativePath, isFilePath } from '../utils/path-utils';

import type { HookData, ModuleRequest } from '../types';
import type { ResolveHookContext, ResolveHookSync } from 'node:module';

type NextResolveSync = Parameters<ResolveHookSync>[2];

const implicitJsExtensions = ['.js', '.json'];
const implicitTsExtensions = ['.ts', '.tsx', '.jsx'];
const localExtensions = [...implicitTsExtensions, ...implicitJsExtensions];
const dependencyExtensions = [...implicitJsExtensions, ...implicitTsExtensions];

const tsExtensions: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
tsExtensions['.js'] = [ '.ts', '.tsx', '.js', '.jsx' ];
tsExtensions['.jsx'] = [ '.tsx', '.ts', '.jsx', '.js' ];

const verbatimExtensions = new Set(['.ts', '.tsx']);

const splitPathQuery = (value: string) => {
	const queryIndex = value.indexOf('?');

	return queryIndex === -1 ? [value, ''] as const	: [ value.slice(0, queryIndex), value.slice(queryIndex) ] as const;
};

const mapExtensions = (filePath: string) => {
	const [ pathname, pathQuery ] = splitPathQuery(filePath);
	const extension = extname(pathname);

	if (verbatimExtensions.has(extension)) { return }

	const tryPaths: string[] = [];
	const pathMapper = (mappedExtension: string) => pathname.slice(0, -extension.length) + mappedExtension + pathQuery;

	const tryExtensions = tsExtensions[extension];
	if (tryExtensions) {
		tryPaths.push(...tryExtensions.map(pathMapper));

		return tryPaths;
	}

	const unknownPathMapper = (mappedExtension: string) => pathname + mappedExtension + pathQuery;
	const guessExtensions = ((!(filePath.startsWith(fileUrlPrefix) || isFilePath(pathname)) || pathname.includes(nodeModulesPath) || pathname.includes('/node_modules/')) ? dependencyExtensions : localExtensions);
	tryPaths.push(...guessExtensions.map(unknownPathMapper));

	return tryPaths;
};

const urlLikeSpecifierPattern = /^(?:[a-z][\d+.a-z-]*:\/\/|data:|file:|node:)/i;

const isTsconfigPathAliasSpecifier = (specifier: string) => !isFilePath(specifier) && !urlLikeSpecifierPattern.test(specifier);

const getErrorCode = (error: unknown) => error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

const getMissingPathFromNotFound = (error: Error) => {
	if ('url' in error && typeof error.url === 'string') { return error.url }
	return undefined;
};

const isModuleFound = (code: string | undefined) => code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND';

const resolveExtensionsSync = (url: string, context: ResolveHookContext, nextResolve: NextResolveSync, throwError = false): ReturnType<NextResolveSync> | undefined => {
	const tryPaths = mapExtensions(url);
	if (!tryPaths || tryPaths.length === 0) {
		return undefined;
	}

	let caughtError: unknown;
	for (const tsPath of tryPaths) {
		try {
			return nextResolve(tsPath, context);
		} catch (error) {
			const code = getErrorCode(error);
			if (isModuleFound(code) && code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') { throw error }

			caughtError = error;
		}
	}

	if (throwError) { throw caughtError }

	return undefined;
};

const resolveExtensionsOrThrowSync = (url: string, context: ResolveHookContext, nextResolve: NextResolveSync): ReturnType<NextResolveSync> => {
	const resolved = resolveExtensionsSync(url, context, nextResolve, true);
	if (resolved === undefined) { throw new Error(`No extension candidates available for ${url}`) }
	return resolved;
};

/**
 * Only prioritize TypeScript extensions for file paths (no dependencies)
 * TS aliases are pre-resolved so they're file paths
 *
 * If `allowJs` is set in `tsconfig.json`, then we'll apply the same resolution logic
 * to files without a TypeScript extension.
 * @param specifier The module specifier to resolve.
 * @param context The resolve hook context.
 * @param hookData Additional data for the resolve hook.
 * @returns A boolean indicating whether TypeScript extensions should be tried for the given specifier.
 */
const shouldTryTsExtensions = (specifier: string, context: ResolveHookContext, hookData: HookData) => {
	if (tsExtensionsPattern.test(specifier)) { return false }

	const parentIsTypeScript = context.parentURL !== undefined && tsExtensionsPattern.test(context.parentURL);
	return ((specifier.startsWith(fileUrlPrefix) || isRelativePath(specifier)) && (parentIsTypeScript || (ensureParsedTsconfig(hookData)?.compilerOptions.allowJs ?? false)));
};

const resolveBaseSync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: HookData) => {
	if (shouldTryTsExtensions(specifier, context, hookData)) {
		const resolved = resolveExtensionsSync(specifier, context, nextResolve);
		if (resolved) { return resolved }
	}

	try {
		return nextResolve(specifier, context);
	} catch (error) {
		if (error instanceof Error && !isModuleFound(getErrorCode(error))) {
			// Resolving .js -> .ts in exports/imports map
			const errorPath = getMissingPathFromNotFound(error);
			if (errorPath) {
				const resolved = resolveExtensionsSync(errorPath, context, nextResolve);
				if (resolved) { return resolved }
			}
		}

		throw error;
	}
};

const normalizeDirectorySpecifier = (specifier: string) => ((specifier === '.' || specifier === '..' || specifier.endsWith('/..')) ? `${specifier}/` : specifier);

const resolveDirectorySync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: HookData) => {
	specifier = normalizeDirectorySpecifier(specifier);

	if (isDirectoryPattern.test(specifier)) {
		// A bare specifier with a trailing slash (e.g. `process/`) is a package, not a relative directory
		// https://github.com/privatenumber/tsx/issues/800
		if (!isFilePath(specifier) && !specifier.startsWith(fileUrlPrefix)) {
			return resolveBaseSync(specifier, context, nextResolve, hookData);
		}

		const urlParsed = new URL(specifier, context.parentURL);

		// If directory, can be index.js, index.ts, etc.
		urlParsed.pathname = posix.join(urlParsed.pathname, 'index');

		return resolveExtensionsOrThrowSync(urlParsed.toString(), context, nextResolve);
	}

	try {
		return resolveBaseSync(specifier, context, nextResolve, hookData);
	} catch (error) {
		if (error instanceof Error && getErrorCode(error) === 'ERR_UNSUPPORTED_DIR_IMPORT') {
			const errorPath = getMissingPathFromNotFound(error);
			if (errorPath) {
				try {
					return resolveExtensionsOrThrowSync(`${errorPath}/index`, context, nextResolve);
				} catch (indexError) {
					if (!(indexError instanceof Error)) { throw indexError }

					const { message } = indexError;
					// eslint-disable-next-line quotes
					indexError.message = indexError.message.replace(`${'/index'.replace('/', sep)}'`, "'");
					if (typeof indexError.stack === 'string') { indexError.stack = indexError.stack.replace(message, indexError.message) }
					throw indexError;
				}
			}
		}

		throw error;
	}
};

const resolveTsPathsSync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: HookData) => {
	const parsedTsconfig = ensureParsedTsconfig(hookData);

	// Bare specifier or TS path alias (e.g. `ns:foo`) && TS path alias
	if (isTsconfigPathAliasSpecifier(specifier) && parsedTsconfig && !context.parentURL?.includes('/node_modules/')) {
		for (const possiblePath of resolveTsconfigPaths(parsedTsconfig, specifier)) {
			try {
				return resolveDirectorySync(pathToFileURL(possiblePath).toString(), context, nextResolve, hookData);
			} catch { /* ignore */ }
		}
	}

	return resolveDirectorySync(specifier, context, nextResolve, hookData);
};

const tsnodeProtocol = 'tsnode://';
const explicitRuntimeFilePattern = /\.(?:m?js|json)($|\?)/;

const addQuery = (url: string, query: string) => `${url}${url.includes('?') ? '&' : '?'}${query}`;
const splitRequestSpecifier = (specifier: string): readonly [string, string | undefined] => {
	const queryIndex = specifier.indexOf('?');
	if (queryIndex === -1) { return [specifier, undefined] }

	const nextQueryIndex = specifier.indexOf('?', queryIndex + 1);
	return [specifier.slice(0, queryIndex), specifier.slice(queryIndex + 1, nextQueryIndex === -1 ? specifier.length : nextQueryIndex)];
};

const isModuleRequest = (value: unknown): value is ModuleRequest => {
	return value !== null && typeof value === 'object' && 'namespace' in value && typeof value.namespace === 'string' && 'specifier' in value && typeof value.specifier === 'string' && 'parentURL' in value && typeof value.parentURL === 'string';
};

const getRequestContext = (specifier: string, context: ResolveHookContext, { namespace }: HookData) => {
	// Inherit namespace from parent
	let requestNamespace = getNamespace(specifier) ?? (context.parentURL && getNamespace(context.parentURL));
	let parentURL = context.parentURL;

	if (namespace) {
		let moduleRequest: ModuleRequest | undefined;

		// Initial request from tsImport()
		if (specifier.startsWith(tsnodeProtocol)) {
			try {
				const request: unknown = JSON.parse(specifier.slice(tsnodeProtocol.length));
				if (isModuleRequest(request)) { moduleRequest = request }
			} catch { /* ignore */ }

			if (moduleRequest?.namespace) { requestNamespace = moduleRequest.namespace }
		}

		if (namespace !== requestNamespace) { return }

		if (moduleRequest) {
			specifier = moduleRequest.specifier;
			parentURL = moduleRequest.parentURL;
		}
	}

	return { specifier, requestNamespace, parentURL };
};

const finalizeResolved = (resolved: ReturnType<ResolveHookSync>, query: string | undefined, requestNamespace: string | undefined) => {
	if (query) { resolved.url = addQuery(resolved.url, query) }

	// Inherit namespace
	if (requestNamespace && !resolved.url.includes(namespaceQuery)) {
		resolved.url = addQuery(resolved.url, `${namespaceQuery}${requestNamespace}`);
	}

	return resolved;
};

const shouldFinalizeDirectResolve = (resolved: ReturnType<ResolveHookSync>) => {
	if ((!resolved.format || resolved.format === 'module-typescript') && resolved.url.startsWith(fileUrlPrefix)) {
		resolved.format = getFormatFromFileUrl(resolved.url);
	}

	return resolved;
};

const isValidDirectSpecifier = (specifier: string, hookData: HookData) => {
	return !hookData.namespace && !specifier.startsWith(tsnodeProtocol) && !specifier.includes(namespaceQuery) && !specifier.includes('?') && !isDirectoryPattern.test(specifier) && (specifier.startsWith(fileUrlPrefix) || isRelativePath(specifier) || isFilePath(specifier));
};

const canUseDirectFileResolve = (specifier: string, hookData: HookData) => {
	return isValidDirectSpecifier(specifier, hookData) && tsExtensionsPattern.test(specifier);
};

const canTryDirectRuntimeResolve = (specifier: string, context: ResolveHookContext, hookData: HookData) => {
	return isValidDirectSpecifier(specifier, hookData) && explicitRuntimeFilePattern.test(specifier) && !tsExtensionsPattern.test(context.parentURL ?? '');
};

const createResolveWithoutNamespace = (hookData: HookData): ResolveHookSync => ((specifier, context, nextResolve) => {
	if (!hookData.active || specifier.startsWith('node:')) { return nextResolve(specifier, context) }

	if (hookData.virtualSources?.has(specifier)) { return { format: 'module', shortCircuit: true, url: specifier } }

	if (canUseDirectFileResolve(specifier, hookData)) { return shouldFinalizeDirectResolve(nextResolve(specifier, context)) }

	if (canTryDirectRuntimeResolve(specifier, context, hookData)) {
		try {
			return shouldFinalizeDirectResolve(nextResolve(specifier, context));
		} catch (error) {
			if (isModuleFound(getErrorCode(error))) { throw error }
		}
	}

	const resolved = resolveTsPathsSync(specifier, context, nextResolve, hookData);

	return resolved.format === 'builtin' ? resolved : shouldFinalizeDirectResolve(resolved);
});

const createResolveWithNamespace = (hookData: HookData): ResolveHookSync => ((specifier, context, nextResolve) => {
	if (!hookData.active || specifier.startsWith('node:')) { return nextResolve(specifier, context) }

	const request = getRequestContext(specifier, context, hookData);
	if (!request) { return nextResolve(specifier, context) }

	const resolvedContext = request.parentURL && request.parentURL !== context.parentURL ? { ...context, parentURL: request.parentURL } : context;
	const [ cleanSpecifier, query ] = splitRequestSpecifier(request.specifier);
	const resolved = resolveTsPathsSync(cleanSpecifier, resolvedContext, nextResolve, hookData);

	if (resolved.format === 'builtin') { return resolved }

	shouldFinalizeDirectResolve(resolved);

	return finalizeResolved(resolved, query, request.requestNamespace);
});

export const createResolveSync = (hookData: HookData): ResolveHookSync => {
	const resolve = (hookData.namespace ? createResolveWithNamespace(hookData) : createResolveWithoutNamespace(hookData));

	if (!debugEnabled) { return resolve }

	return (specifier, context, nextResolve) => {
		log(2, 'resolveSync', {specifier, context });
		const result = resolve(specifier, context, nextResolve);
		log(1, 'resolvedSync', { specifier, context, result });

		return result;
	};
};
