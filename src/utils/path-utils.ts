import { fileURLToPath } from 'node:url';
import { encoding } from '../utils/constants';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve, join, sep } from 'node:path';

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
export const isFilePath = (request: string) => (isRelativePath(request) || isAbsolute(request));

// In Node, bare specifiers (packages and core modules) do not accept queries
export const requestAcceptsQuery = (request: string) => {
	// ./foo.js?query | /foo.js?query in UNIX
	if (isFilePath(request)) { return true }

	const scheme = getScheme(request);

	// Expected to be file, https, etc... | node:url maps to a bare-specifier, which does not accept queries. But URLs like file:// or https:// do
	return (scheme && scheme !== 'node');
};

export const fileUrlPrefix = 'file://';

export const normalizeFileUrlPath = (request: string) => {
	if (!request.startsWith(fileUrlPrefix)) { return request }

	try { return fileURLToPath(request) } catch { return request }
};

const implicitEntrypointExtensions = ['.ts', '.tsx', '.jsx', '.js', '.json'];

const tryResolveFile = (candidatePath: string) => {
	try { return statSync(candidatePath).isFile() ? candidatePath : undefined } catch { return undefined }
};

export const resolveEntrypointPath = (request: string) => {
	const normalizedRequest = normalizeFileUrlPath(request);
	const resolvedRequest = resolve(normalizedRequest);

	const directFile = tryResolveFile(resolvedRequest);

	if (directFile) { return directFile }

	for (const extension of implicitEntrypointExtensions) {
		const implicitFile = tryResolveFile(resolvedRequest + extension);
		if (implicitFile) { return implicitFile }
	}

	for (const extension of implicitEntrypointExtensions) {
		const indexFile = tryResolveFile(join(resolvedRequest, `index${extension}`));
		if (indexFile) { return indexFile }
	}

	return undefined;
};

// Node only marks the actual process entry point module as import.meta.main; a dynamically `import()`-ed module
// can never satisfy that, so entries relying on it must be forked instead of run through the in-process fast path.
const tokenGap = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*`;
const importMetaMainPattern = new RegExp(String.raw`^import${tokenGap}\.${tokenGap}meta\b${tokenGap}(?:\.${tokenGap}main\b|\[|(?=[;,)\s}]|$))`);

/**
 * Checks if the given source code contains a usage of import.meta.main.
 * @param source The source code to check for import.meta.main usage.
 * @returns True if the source code contains import.meta.main, false otherwise.
 */
export const hasImportMetaMain = (source: string) => {
	let index = 0;
	const length = source.length;

	/**
	 * Scans the source code for import.meta.main usage, taking into account template literal substitutions.
	 * @param inSubstitution Indicates whether the current scan is within a template literal substitution.
	 * @returns True if import.meta.main is found within the scanned code, false otherwise.
	 */
	const scanCode = (inSubstitution = false) => {
		let braces = 0;

		while (index < length) {
			if (inSubstitution && source[index] === '}') {
				index += 1;

				if (braces === 0) { return false }

				braces -= 1;

				continue;
			}

			if (source[index] === '{') { braces += 1 }

			if (source[index] === '/' && source[index + 1] === '/') {
				index = source.indexOf('\n', index + 2);

				if (index === -1) { return false }

				continue;
			}

			if (source[index] === '/' && source[index + 1] === '*') {
				index = source.indexOf('*/', index + 2);

				if (index === -1) { return false }

				index += 2;

				continue;
			}

			if (source[index] === '`') {
				index += 1;
				while (index < length) {
					if (source[index] === '\\') {
						index += 2;
					} else if (source[index] === '$' && source[index + 1] === '{') {
						index += 2;
						if (scanCode(true)) { return true }
					} else if (source[index++] === '`') {
						break;
					}
				}
				continue;
			}

			if (source[index] === '"' || source[index] === '\'') {
				const quote = source[index++];

				while (index < length) {
					if (source[index] === '\\') {
						index += 2;
					} else if (source[index++] === quote) {
						break;
					}
				}

				continue;
			}

			if (source.slice(index).match(importMetaMainPattern)) { return true }

			index += 1;
		}

		return false;
	};

	return scanCode();
};

export const entryUsesImportMetaMain = (entryPath: string) => {
	try { return hasImportMetaMain(readFileSync(entryPath, encoding)) } catch { return false }
};

export const tsExtensions = ['.ts', '.tsx', '.jsx'];
export const tsExtensionsPattern = /\.(?:ts|[tj]sx)($|\?)/;
export const implicitTsExtensionsPattern = /\.(?:ts|tsx|jsx)($|\?)/;
export const isJsonPattern = /\.json($|\?)/;
export const isDirectoryPattern = /\/(?:$|\?)/;
// Only matches packages names without subpaths (e.g. `foo` but not `foo/bar`). Back slash included to exclude Windows paths
export const isBarePackageNamePattern = /^(?:@[^/]+\/)?[^/\\]+$/;
export const nodeModulesPath = `${sep}node_modules${sep}`;
