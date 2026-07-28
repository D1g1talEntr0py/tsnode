import { pathToFileURL } from 'node:url';
import { fileUrlPrefix } from '../utils/path-utils';
import type { ScopedImport, TsnodeRequest } from '../types';

// Keep this indirect so bundlers don't try to statically analyze tsnode:// imports.
// eslint-disable-next-line no-new-func
const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<any>;

export const createScopedImport = (namespace: string): ScopedImport => (specifier, parent) => {
	if (!parent) {
		throw new Error('The current file path (import.meta.url) must be provided in the second argument of tsImport()');
	}

	const parentURL = (parent.startsWith(fileUrlPrefix) ? parent : pathToFileURL(parent).toString());

	return dynamicImport(`tsnode://${JSON.stringify({ specifier, parentURL, namespace } satisfies TsnodeRequest)}`);
};
