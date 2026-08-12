import { tsExtensions } from '../utils/path-utils';

const moduleExtensions = new Set(tsExtensions);

export const canTryNativeTypeStripping = (url: string) => isNativeFileUrl(url);

// .tsx/.jsx are excluded because Node's type stripping doesn't support JSX
const typescriptFilePattern = /\.ts($|\?)/;

/**
 * Node refuses to strip types inside node_modules
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so dependencies always go through esbuild
 * @param url The file URL to check.
 * @returns True if the file URL is a TypeScript file outside node_modules, otherwise false.
 */
export const isNativeFileUrl = (url: string) => (typescriptFilePattern.test(url) && !url.includes('/node_modules/'));

/**
 * ESM-only: every TypeScript file is treated as a module, so format
 * detection never needs to walk package.json files.
 *
 * Extension is extracted with string scans instead of constructing a URL
 * since this runs for every resolved file path.
 * @param fileUrl The file URL to check.
 * @returns 'module' if the file URL has a known module extension, otherwise undefined.
 */
export const getFormatFromFileUrl = (fileUrl: string) => {
	// Find end of pathname (before query/hash)
	let end = fileUrl.indexOf('?');
	const hashIndex = fileUrl.indexOf('#');

	if (end === -1 || (hashIndex !== -1 && hashIndex < end)) { end = hashIndex }
	if (end === -1) { end = fileUrl.length }

	const dotIndex = fileUrl.lastIndexOf('.', end - 1);
	if (dotIndex > fileUrl.lastIndexOf('/', end - 1) && moduleExtensions.has(fileUrl.slice(dotIndex, end))) {
		return 'module';
	}

	// .js and unknown extensions: leave format undefined so Node detects it
	return undefined;
};

export const namespaceQuery = 'tsnode-namespace=';

export const getNamespace = (url: string) => {
	const index = url.indexOf(namespaceQuery);
	if (index === -1) { return }

	const charBefore = url[index - 1];
	if (charBefore !== '?' && charBefore !== '&') { return }

	const startIndex = index + namespaceQuery.length;
	const endIndex = url.indexOf('&', startIndex);

	return endIndex === -1 ? url.slice(startIndex) : url.slice(startIndex, endIndex);
};