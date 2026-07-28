import { pathToFileURL } from 'node:url';
import { extname, isAbsolute, posix, sep } from 'node:path';
import { readJsonFileSync } from '../utils/read-json-file';
import { resolveTsconfigPaths } from '../utils/tsconfig';
import { logEsm as log, debugEnabled } from '../utils/debug';
import { ensureParsedTsconfig, type Data } from './initialize';
import { getFormatFromFileUrl, namespaceQuery, getNamespace } from './utils';
import { fileUrlPrefix, nodeModulesPath, tsExtensionsPattern, isDirectoryPattern, isRelativePath, isFilePath } from '../utils/path-utils';

import type { NodeError, TsnodeRequest } from '../types';
import type { ResolveHook, ResolveHookContext, ResolveHookSync } from 'node:module';

type NextResolveSync = Parameters<ResolveHookSync>[2];

type PackageJson = { main?: string, [key: string]: unknown };

const implicitJsExtensions = ['.js', '.json'];
const implicitTsExtensions = ['.ts', '.tsx', '.jsx'];
const localExtensions = [...implicitTsExtensions, ...implicitJsExtensions];
const dependencyExtensions = [...implicitJsExtensions, ...implicitTsExtensions];

const tsExtensions: Record<string, string[]> = Object.create(null);
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

const getMissingPathFromNotFound = (nodeError: NodeError) => {
	if (nodeError.url) { return nodeError.url }

	const isExportPath = nodeError.message.match(/^Cannot find module '([^']+)'/);
	if (isExportPath) {
		const [ , exportPath ] = isExportPath;
		return exportPath;
	}

	const isPackagePath = nodeError.message.match(/^Cannot find package '([^']+)'/);
	if (isPackagePath) {
		const [ , packagePath ] = isPackagePath;
		if (!isAbsolute(packagePath)) { return }

		const packageUrl = pathToFileURL(packagePath);

		// Node v20.0.0 logs the package directory. Slash check / works on Windows as well because it's a path URL
		if (packageUrl.pathname.endsWith('/')) { packageUrl.pathname += 'package.json' }

		// Node v21+ logs the package package.json path
		if (packageUrl.pathname.endsWith('/package.json')) {
			const packageJson = readJsonFileSync<PackageJson>(packageUrl);
			if (packageJson?.main) { return new URL(packageJson.main, packageUrl).toString() }
		} else {
			// Node v22.6.0 logs the entry path so we don't need to look it up from package.json
			return packageUrl.toString();
		}
	}

	return undefined;
};

const isModuleNotFound = (code: string | undefined) => code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';

const resolveExtensionsSync = (url: string, context: ResolveHookContext, nextResolve: NextResolveSync, throwError?: boolean) => {
	const tryPaths = mapExtensions(url);
	if (!tryPaths) { return undefined }

	let caughtError: unknown;
	for (const tsPath of tryPaths) {
		try {
			return nextResolve(tsPath, context);
		} catch (error) {
			const { code } = error as NodeError;
			if (!isModuleNotFound(code) && code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') { throw error }

			caughtError = error;
		}
	}

	if (throwError) {
		// All candidates were skipped; resolve one to produce a real error
		if (caughtError === undefined) { return nextResolve(tryPaths[0], context) }
		throw caughtError;
	}

	return undefined;
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
const shouldTryTsExtensions = (specifier: string, context: ResolveHookContext, hookData: Data) => {
	if (tsExtensionsPattern.test(specifier)) { return false }

	return ((specifier.startsWith(fileUrlPrefix) || isRelativePath(specifier)) && (tsExtensionsPattern.test(context.parentURL!) || (ensureParsedTsconfig(hookData)?.compilerOptions.allowJs ?? false)));
};

const resolveBaseSync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: Data) => {
	if (shouldTryTsExtensions(specifier, context, hookData)) {
		const resolved = resolveExtensionsSync(specifier, context, nextResolve);
		if (resolved) { return resolved }
	}

	try {
		return nextResolve(specifier, context);
	} catch (error) {
		if (error instanceof Error) {
			const nodeError = error as NodeError;
			if (isModuleNotFound(nodeError.code)) {
				// Resolving .js -> .ts in exports/imports map
				const errorPath = getMissingPathFromNotFound(nodeError);
				if (errorPath) {
					const resolved = resolveExtensionsSync(errorPath, context, nextResolve);
					if (resolved) { return resolved }
				}
			}
		}

		throw error;
	}
};

const normalizeDirectorySpecifier = (specifier: string) => ((specifier === '.' || specifier === '..' || specifier.endsWith('/..')) ? `${specifier}/` : specifier);

const resolveDirectorySync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: Data) => {
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

		return resolveExtensionsSync(urlParsed.toString(), context, nextResolve, true)!;
	}

	try {
		return resolveBaseSync(specifier, context, nextResolve, hookData);
	} catch (error) {
		if (error instanceof Error) {
			const nodeError = error as NodeError;
			if (nodeError.code === 'ERR_UNSUPPORTED_DIR_IMPORT') {
				const errorPath = getMissingPathFromNotFound(nodeError);
				if (errorPath) {
					try {
						return resolveExtensionsSync(`${errorPath}/index`, context, nextResolve, true)!;
					} catch (_error) {
						const __error = _error as Error;
						const { message } = __error;
						__error.message = __error.message.replace(`${'/index'.replace('/', sep)}'`, "'");
						__error.stack = __error.stack!.replace(message, __error.message);
						throw __error;
					}
				}
			}
		}

		throw error;
	}
};

const resolveTsPathsSync = (specifier: string, context: ResolveHookContext, nextResolve: NextResolveSync, hookData: Data) => {
	const parsedTsconfig = ensureParsedTsconfig(hookData);

	// Bare specifier or TS path alias (e.g. `ns:foo`) && TS path alias
	if (isTsconfigPathAliasSpecifier(specifier) && parsedTsconfig && !context.parentURL?.includes('/node_modules/')) {
		for (const possiblePath of resolveTsconfigPaths(parsedTsconfig, specifier)) {
			try {
				return resolveDirectorySync(pathToFileURL(possiblePath).toString(), context, nextResolve, hookData);
			} catch {}
		}
	}

	return resolveDirectorySync(specifier, context, nextResolve, hookData);
};

const tsnodeProtocol = 'tsnode://';
const explicitRuntimeFilePattern = /\.(?:m?js|json)($|\?)/;

const addQuery = (url: string, query: string) => `${url}${url.includes('?') ? '&' : '?'}${query}`;

const getRequestContext = (specifier: string, context: ResolveHookContext, { namespace }: Data) => {
	// Inherit namespace from parent
	let requestNamespace = getNamespace(specifier) ?? (context.parentURL && getNamespace(context.parentURL));
	let parentURL = context.parentURL;

	if (namespace) {
		let tsImportRequest: TsnodeRequest | undefined;

		// Initial request from tsImport()
		if (specifier.startsWith(tsnodeProtocol)) {
			try { tsImportRequest = JSON.parse(specifier.slice(tsnodeProtocol.length)) } catch {}

			if (tsImportRequest?.namespace) { requestNamespace = tsImportRequest.namespace }
		}

		if (namespace !== requestNamespace) { return }

		if (tsImportRequest) {
			specifier = tsImportRequest.specifier;
			parentURL = tsImportRequest.parentURL;
		}
	}

	return { specifier, requestNamespace, parentURL };
};

const finalizeResolved = (resolved: Awaited<ReturnType<ResolveHook>>, query: string | undefined, requestNamespace: string | undefined) => {
	if (query) { resolved.url = addQuery(resolved.url, query) }

	// Inherit namespace
	if (requestNamespace && !resolved.url.includes(namespaceQuery)) {
		resolved.url = addQuery(resolved.url, `${namespaceQuery}${requestNamespace}`);
	}

	return resolved;
};

const shouldFinalizeDirectResolve = (resolved: Awaited<ReturnType<ResolveHook>>) => {
	if ((!resolved.format || resolved.format === 'module-typescript') && resolved.url.startsWith(fileUrlPrefix)) {
		resolved.format = getFormatFromFileUrl(resolved.url);
	}

	return resolved;
};

const isValidDirectSpecifier = (specifier: string, hookData: Data) => {
	return !hookData.namespace && !specifier.startsWith(tsnodeProtocol) && !specifier.includes(namespaceQuery) && !specifier.includes('?') && !isDirectoryPattern.test(specifier) && (specifier.startsWith(fileUrlPrefix) || isRelativePath(specifier) || isFilePath(specifier));
};

const canUseDirectFileResolve = (specifier: string, hookData: Data) => {
	return isValidDirectSpecifier(specifier, hookData) && tsExtensionsPattern.test(specifier);
};

const canTryDirectRuntimeResolve = (specifier: string, context: ResolveHookContext, hookData: Data) => {
	return isValidDirectSpecifier(specifier, hookData) && explicitRuntimeFilePattern.test(specifier) && !tsExtensionsPattern.test(context.parentURL ?? '');
};

const createResolveWithoutNamespace = (hookData: Data): ResolveHookSync => ((specifier, context, nextResolve) => {
	if (!hookData.active || specifier.startsWith('node:')) { return nextResolve(specifier, context) }

	if (canUseDirectFileResolve(specifier, hookData)) { return shouldFinalizeDirectResolve(nextResolve(specifier, context)) }

	if (canTryDirectRuntimeResolve(specifier, context, hookData)) {
		try {
			return shouldFinalizeDirectResolve(nextResolve(specifier, context));
		} catch (error) {
			if (!isModuleNotFound((error as NodeError).code)) { throw error }
		}
	}

	const resolved = resolveTsPathsSync(specifier, context, nextResolve, hookData);

	return resolved.format === 'builtin' ? resolved : shouldFinalizeDirectResolve(resolved);
});

const createResolveWithNamespace = (hookData: Data): ResolveHookSync => ((specifier, context, nextResolve) => {
	if (!hookData.active || specifier.startsWith('node:')) { return nextResolve(specifier, context) }

	const request = getRequestContext(specifier, context, hookData);
	if (!request) { return nextResolve(specifier, context) }

	const resolvedContext = request.parentURL && request.parentURL !== context.parentURL ? { ...context, parentURL: request.parentURL } : context;
	const [ cleanSpecifier, query ] = request.specifier.split('?');
	const resolved = resolveTsPathsSync(cleanSpecifier, resolvedContext, nextResolve, hookData);

	if (resolved.format === 'builtin') { return resolved }

	shouldFinalizeDirectResolve(resolved);

	return finalizeResolved(resolved, query, request.requestNamespace);
});

export const createResolveSync = (hookData: Data): ResolveHookSync => {
	const resolve = (hookData.namespace ? createResolveWithNamespace(hookData) : createResolveWithoutNamespace(hookData));

	if (!debugEnabled) { return resolve }

	return (specifier, context, nextResolve) => {
		log(2, 'resolveSync', {specifier, context });
		const result = resolve(specifier, context, nextResolve);
		log(1, 'resolvedSync', { specifier, context, result });

		return result;
	};
};
