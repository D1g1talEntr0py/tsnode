import { pathToFileURL } from 'node:url';
import { fileUrlPrefix } from '../utils/path-utils';
import type { DynamicImport, ModuleNamespace, ScopedImport } from '../types';

// Keep this indirect so bundlers don't try to statically analyze tsnode:// imports.
const nativeEval = globalThis[('ev' + 'al') as 'eval'];
const dynamicImport = nativeEval('(specifier) => import(specifier);') as DynamicImport;

export const createScopedImport = (namespace: string): ScopedImport => <TModule extends object = ModuleNamespace>(specifier: string, parent: string) => {
	if (!parent) {
		throw new Error('The current file path (import.meta.url) must be provided in the second argument of tsImport()');
	}

	const parentURL = parent.startsWith(fileUrlPrefix) ? parent : pathToFileURL(parent).toString();

	return dynamicImport<TModule>(`tsnode://${JSON.stringify({ specifier, parentURL, namespace })}`);
};