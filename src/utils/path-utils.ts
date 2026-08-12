import path from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Prior to calling this function, it's expected that Windows paths have been filtered out
 * via path.isAbsolute()
 *
 * Windows paths cannot be correctly parsed (e.g. new URL('C:\Users\Example\file.txt')
 * @param url The URL to get the scheme from
 * @returns The scheme of the URL, or undefined if the URL is not valid
 */
const getScheme = (url: string) => {
	const schemeIndex = url.indexOf(':');

	return schemeIndex === -1 ? undefined : url.slice(0, schemeIndex);
};

export const isRelativePath = (request: string) => request[0] === '.' && (request[1] === '/' || (request[1] === '.' && request[2] === '/'));
export const isFilePath = (request: string) => (isRelativePath(request) || path.isAbsolute(request));

// In Node, bare specifiers (packages and core modules) do not accept queries
export const requestAcceptsQuery = (request: string) => {
	// ./foo.js?query
	// /foo.js?query in UNIX
	if (isFilePath(request)) { return true }

	const scheme = getScheme(request);
	// Expected to be file, https, etc...
	// node:url maps to a bare-specifier, which does not accept queries
	// But URLs like file:// or https:// do
	return (scheme && scheme !== 'node');
};

export const fileUrlPrefix = 'file://';

export const normalizeFileUrlPath = (request: string) => {
	if (!request.startsWith(fileUrlPrefix)) { return request }

	try {
		return fileURLToPath(request);
	} catch {
		return request;
	}
};

const implicitEntrypointExtensions = ['.ts', '.tsx', '.jsx', '.js', '.json'];

const tryResolveFile = (candidatePath: string) => {
	try {
		return statSync(candidatePath).isFile() ? candidatePath : undefined;
	} catch {
		return undefined;
	}
};

export const resolveEntrypointPath = (request: string) => {
	const normalizedRequest = normalizeFileUrlPath(request);
	const resolvedRequest = path.resolve(normalizedRequest);

	const directFile = tryResolveFile(resolvedRequest);
	if (directFile) { return directFile }

	for (const extension of implicitEntrypointExtensions) {
		const implicitFile = tryResolveFile(resolvedRequest + extension);
		if (implicitFile) { return implicitFile }
	}

	for (const extension of implicitEntrypointExtensions) {
		const indexFile = tryResolveFile(path.join(resolvedRequest, `index${extension}`));
		if (indexFile) { return indexFile }
	}

	return undefined;
};

export const tsExtensions = ['.ts', '.tsx', '.jsx'];
export const tsExtensionsPattern = /\.(?:ts|[tj]sx)($|\?)/;
export const implicitTsExtensionsPattern = /\.(?:ts|tsx|jsx)($|\?)/;
export const isJsonPattern = /\.json($|\?)/;
export const isDirectoryPattern = /\/(?:$|\?)/;
// Only matches packages names without subpaths (e.g. `foo` but not `foo/bar`)
// Back slash included to exclude Windows paths
export const isBarePackageNamePattern = /^(?:@[^/]+\/)?[^/\\]+$/;
export const nodeModulesPath = `${path.sep}node_modules${path.sep}`;
