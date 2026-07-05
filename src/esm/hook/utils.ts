import path from 'node:path';
import { tsExtensions } from '../../utils/path-utils.js';

/**
 * ESM-only: every TypeScript file is treated as a module, so format
 * detection never needs to walk package.json files.
 */
export const getFormatFromFileUrl = (fileUrl: string) => {
	const { pathname } = new URL(fileUrl);
	const extension = path.extname(pathname);
	if (
		extension === '.mjs'
		|| tsExtensions.includes(extension)
	) {
		return 'module';
	}
	// .js and unknown extensions: leave format undefined so Node detects it
	// (still required for CommonJS dependencies in node_modules)
};

export const namespaceQuery = 'tsx-namespace=';

export const getNamespace = (
	url: string,
) => {
	const index = url.indexOf(namespaceQuery);
	if (index === -1) {
		return;
	}

	const charBefore = url[index - 1];
	if (charBefore !== '?' && charBefore !== '&') {
		return;
	}

	const startIndex = index + namespaceQuery.length;
	const endIndex = url.indexOf('&', startIndex);

	return (
		endIndex === -1
			? url.slice(startIndex)
			: url.slice(startIndex, endIndex)
	);
};
