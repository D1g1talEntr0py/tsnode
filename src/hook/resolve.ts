import { pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { extname, posix, sep } from 'node:path';
import { resolveTsconfigPaths } from '../utils/tsconfig';
import { logEsm as log, debugEnabled } from '../utils/debug';
import { ensureParsedTsconfig } from './initialize';
import { getFormatFromFileUrl, namespaceQuery, getNamespace, getModuleRequest } from './utils';
import { fileUrlPrefix, nodeModulesPath, tsExtensionsPattern, isDirectoryPattern, isRelativePath, isFilePath } from '../utils/path-utils';
import type { HookData } from '../types';
import type { ResolveHookContext, ResolveHookSync } from 'node:module';

type NextResolveSync = Parameters<ResolveHookSync>[2];

const tsnodeProtocol = 'tsnode://';
const explicitRuntimeFilePattern = /\.(?:js|json)($|\?)/;
const urlLikeSpecifierPattern = /^(?:[a-z][\d+.a-z-]*:\/\/|data:|file:|node:)/i;
const implicitJsExtensions = [ '.js', '.json' ] as const;
const implicitTsExtensions = [ '.ts', '.tsx', '.jsx' ] as const;
const localExtensions = [ ...implicitTsExtensions, ...implicitJsExtensions ] as const;
const dependencyExtensions = [ ...implicitJsExtensions, ...implicitTsExtensions ] as const;
const verbatimExtensions = new Set([ '.ts', '.tsx' ]);
const tsExtensions = Object.create(null) as Record<string, string[]>;
tsExtensions['.js'] = [ '.ts', '.tsx', '.js', '.jsx' ];
tsExtensions['.jsx'] = [ '.tsx', '.ts', '.jsx', '.js' ];

/**
 * Splits a file path into the pathname and query string components.
 * @param value The file path to split.
 * @returns A tuple containing the pathname and query string.
 */
const splitPathQuery = (value: string) => {
	const queryIndex = value.indexOf('?');

	return queryIndex === -1 ? [ value, '' ] as const : [ value.slice(0, queryIndex), value.slice(queryIndex) ];
};

/**
 * Maps a given file path to possible extensions based on TypeScript and JavaScript conventions.
 * @param filePath The file path to map extensions for.
 * @returns An array of file paths with mapped extensions. Or an empty array if no extensions could be mapped.
 */
const mapExtensions = (filePath: string) => {
	const [ pathname, pathQuery ] = splitPathQuery(filePath);
	const extension = extname(pathname);

	if (verbatimExtensions.has(extension)) { return [] }

	const tryPaths: string[] = [];
	const tryExtensions = tsExtensions[extension];

	if (tryExtensions) {
		for (const mappedExtension of tryExtensions) {
			tryPaths.push(pathname.slice(0, -extension.length) + mappedExtension + pathQuery);
		}

		return tryPaths;
	}

	for (const mappedExtension of (!(filePath.startsWith(fileUrlPrefix) || isFilePath(pathname)) || pathname.includes(nodeModulesPath) || pathname.includes('/node_modules/')) ? dependencyExtensions : localExtensions) {
		tryPaths.push(pathname + mappedExtension + pathQuery);
	}

	return tryPaths;
};

const isTsconfigPathAliasSpecifier = (specifier: string) => !isFilePath(specifier) && !urlLikeSpecifierPattern.test(specifier);

const getErrorCode = (error: unknown) => error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

const getMissingPathFromNotFound = (error: Error) => {
	if ('url' in error && typeof error.url === 'string') { return error.url }
	return undefined;
};

/**
 * Checks if a module was found based on the error code.
 * @param code The error code to check.
 * @returns True if the module was found, false otherwise.
 */
const isModuleFound = (code: string | undefined) => code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND';

/**
 * Resolves a module specifier with TypeScript extensions, trying multiple candidates.
 * @param url The module specifier to resolve.
 * @param context The resolve hook context.
 * @param nextResolve The next resolve function in the hook chain.
 * @param throwError Whether to throw an error if no candidates are available.
 * @returns The resolved module path or undefined if no candidates are found.
 */
const resolveExtensionsSync = (url: string, context: ResolveHookContext, nextResolve: NextResolveSync, throwError = false): ReturnType<NextResolveSync> | undefined => {
	const tryPaths = mapExtensions(url);

	if (tryPaths.length === 0) { return undefined }

	let caughtError: unknown;
	for (const tsPath of tryPaths) {
		try { return nextResolve(tsPath, context) } catch (error) {
			const code = getErrorCode(error);

			if (isModuleFound(code) && code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') { throw error }

			caughtError = error;
		}
	}

	if (throwError) { throw caughtError }

	return undefined;
};

/**
 * Resolves a module specifier with TypeScript extensions, throwing an error if no candidates are available.
 * @param url The module specifier to resolve.
 * @param context The resolve hook context.
 * @param nextResolve The next resolve function in the hook chain.
 * @returns The resolved module path.
 */
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

	// Only try TypeScript extensions for file paths that are either relative or have a file URL prefix.
	return ((specifier.startsWith(fileUrlPrefix) || isRelativePath(specifier)) && (context.parentURL !== undefined && tsExtensionsPattern.test(context.parentURL) || (ensureParsedTsconfig(hookData)?.compilerOptions.allowJs ?? false)));
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

/**
 * Normalizes a directory specifier by ensuring it ends with a slash if necessary.
 * @param specifier The module specifier to normalize.
 * @returns The normalized directory specifier.
 */
const normalizeDirectorySpecifier = (specifier: string) => ((specifier === '.' || specifier === '..' || specifier.endsWith('/..')) ? `${specifier}/` : specifier);

/**
 * Resolves a directory specifier synchronously.
 * @param specifier The module specifier to resolve.
 * @param context The resolve hook context.
 * @param nextResolve The next resolve function in the hook chain.
 * @param hookData The hook data.
 * @returns The resolved module URL.
 */
const resolveDirectorySync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: HookData) => {
	specifier = normalizeDirectorySpecifier(specifier);

	if (isDirectoryPattern.test(specifier)) {
		// A bare specifier with a trailing slash (e.g. `process/`) is a package, not a relative directory
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

/**
 * Resolves TypeScript paths synchronously.
 * @param specifier The module specifier to resolve.
 * @param context The resolve hook context.
 * @param nextResolve The next resolve function in the hook chain.
 * @param hookData The hook data.
 * @returns The resolved module URL.
 */
const resolveTsPathsSync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: HookData) => {
	// Bare specifier or TS path alias (e.g. `ns:foo`) && TS path alias
	if (isTsconfigPathAliasSpecifier(specifier) && !context.parentURL?.includes('/node_modules/')) {
		const parsedTsconfig = ensureParsedTsconfig(hookData);
		if (parsedTsconfig) {
			for (const possiblePath of resolveTsconfigPaths(parsedTsconfig, specifier)) {
				try {
					return resolveDirectorySync(pathToFileURL(possiblePath).toString(), context, nextResolve, hookData);
				} catch { /* ignore */ }
			}
		}
	}

	return resolveDirectorySync(specifier, context, nextResolve, hookData);
};

/**
 * Adds a query string to a URL.
 * @param url The URL to which the query string should be added.
 * @param query The query string to add.
 * @returns The URL with the added query string.
 */
const addQuery = (url: string, query: string) => {
	const parsed = new URL(url);
	parsed.search += `${parsed.search ? '&' : '?'}${query}`;

	return parsed.href;
};

/**
 * Splits a request specifier into its main part, query, and fragment.
 * @param specifier The module specifier to split.
 * @returns A tuple containing the main part, query, and fragment of the specifier.
 */
const splitRequestSpecifier = (specifier: string): readonly [string, string | undefined, string | undefined] => {
	const queryIndex = specifier.indexOf('?');
	const hashIndex = specifier.indexOf('#', specifier.startsWith('#') ? 1 : 0);
	const splitSpecifier: [string, string | undefined, string | undefined] = [ '', undefined, hashIndex === -1 ? undefined : specifier.slice(hashIndex) ];

	if (queryIndex === -1 || (hashIndex !== -1 && hashIndex < queryIndex)) {
		splitSpecifier[0] = hashIndex === -1 ? specifier : specifier.slice(0, hashIndex);
	} else {
		splitSpecifier[0] = specifier.slice(0, queryIndex);
		splitSpecifier[1] = specifier.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
	}

	return splitSpecifier;
};

/**
 * Gets the request context for a module specifier.
 * @param specifier The module specifier.
 * @param context The resolve hook context.
 * @param hookData The hook data containing the namespace.
 * @returns The request context including the specifier, request namespace, and parent URL.
 */
const getRequestContext = (specifier: string, context: ResolveHookContext, { namespace }: HookData) => {
	// Inherit namespace from parent
	let requestNamespace = getNamespace(specifier) ?? (context.parentURL && getNamespace(context.parentURL));
	let parentURL = context.parentURL;

	if (namespace) {
		const moduleRequest = getModuleRequest(specifier);
		if (moduleRequest) { requestNamespace = moduleRequest.namespace }

		if (namespace !== requestNamespace) { return }

		if (moduleRequest) {
			specifier = moduleRequest.specifier;
			parentURL = moduleRequest.parentURL;
		}
	}

	return { specifier, requestNamespace, parentURL };
};

const finalizeResolved = (resolved: ReturnType<ResolveHookSync>, query: string | undefined, requestNamespace: string | undefined, fragment: string | undefined) => {
	if (resolved.format === 'builtin' || resolved.url.startsWith('node:') || resolved.url.startsWith('data:')) { return resolved }

	if (query) { resolved.url = addQuery(resolved.url, query) }

	if (fragment !== undefined) {
		const parsed = new URL(resolved.url);
		parsed.hash = fragment;
		resolved.url = parsed.href;
	}

	// Inherit namespace
	if (requestNamespace && getNamespace(resolved.url) === undefined) {
		resolved.url = addQuery(resolved.url, `${namespaceQuery}${encodeURIComponent(requestNamespace)}`);
	}

	return resolved;
};

/**
 * Determines if a resolved module should be finalized directly.
 * @param resolved The resolved module.
 * @returns The potentially modified resolved module.
 */
const shouldFinalizeDirectResolve = (resolved: ReturnType<ResolveHookSync>) => {
	if ((!resolved.format || resolved.format === 'module-typescript') && resolved.url.startsWith(fileUrlPrefix)) {
		resolved.format = getFormatFromFileUrl(resolved.url);
	}

	return resolved;
};

/**
 * Checks if a module specifier is valid for direct resolution.
 * @param specifier The module specifier.
 * @param hookData The hook data containing the namespace.
 * @returns True if the specifier is valid for direct resolution, false otherwise.
 */
const isValidDirectSpecifier = (specifier: string, hookData: HookData) => {
	return !hookData.namespace && !specifier.startsWith(tsnodeProtocol) && !specifier.includes(namespaceQuery) && !specifier.includes('?') && !isDirectoryPattern.test(specifier) && (specifier.startsWith(fileUrlPrefix) || isRelativePath(specifier) || isFilePath(specifier));
};

/**
 * Checks if a module specifier can be directly resolved as a file.
 * @param specifier The module specifier.
 * @param hookData The hook data containing the namespace.
 * @returns True if the specifier can be directly resolved as a file, false otherwise.
 */
const canUseDirectFileResolve = (specifier: string, hookData: HookData) => {
	return isValidDirectSpecifier(specifier, hookData) && tsExtensionsPattern.test(specifier);
};

/**
 * Checks if a module specifier can be directly resolved as a runtime file.
 * @param specifier The module specifier.
 * @param context The resolve hook context.
 * @param hookData The hook data containing the namespace.
 * @returns True if the specifier can be directly resolved as a runtime file, false otherwise.
 */
const canTryDirectRuntimeResolve = (specifier: string, context: ResolveHookContext, hookData: HookData) => {
	return isValidDirectSpecifier(specifier, hookData) && explicitRuntimeFilePattern.test(specifier) && !tsExtensionsPattern.test(context.parentURL ?? '');
};

/**
 * Creates a resolve hook without a namespace.
 * @param hookData The hook data containing the namespace.
 * @returns A resolve hook function.
 */
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

/**
 * Creates a resolve hook with a namespace.
 * @param hookData The hook data containing the namespace.
 * @returns A resolve hook function.
 */
const createResolveWithNamespace = (hookData: HookData): ResolveHookSync => ((specifier, context, nextResolve) => {
	if (!hookData.active || specifier.startsWith('node:')) { return nextResolve(specifier, context) }

	const request = getRequestContext(specifier, context, hookData);

	if (!request) { return nextResolve(specifier, context) }

	const resolvedContext = request.parentURL && request.parentURL !== context.parentURL ? { ...context, parentURL: request.parentURL } : context;

	if (isBuiltin(request.specifier) || request.specifier.startsWith('data:')) { return nextResolve(request.specifier, resolvedContext) }

	const [ cleanSpecifier, query, fragment ] = splitRequestSpecifier(request.specifier);
	const resolved = resolveTsPathsSync(cleanSpecifier, resolvedContext, nextResolve, hookData);

	if (resolved.format === 'builtin') { return resolved }

	shouldFinalizeDirectResolve(resolved);

	return finalizeResolved(resolved, query, request.requestNamespace, fragment);
});

/**
 * Creates a resolve hook based on the provided hook data.
 * @param hookData The hook data containing the namespace.
 * @returns A resolve hook function.
 */
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
