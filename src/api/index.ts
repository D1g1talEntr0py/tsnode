import { register, registerScoped } from './register';
import { resolve } from 'node:path';
import { getTsconfigCacheKey } from '../utils/tsconfig';
import type { ModuleNamespace, ModuleImport, TsImportOptions, NamespacedUnregister } from '../types';
import { Json } from '../utils/json';

let nextImportNamespace = 0;
let nextOptionIdentity = 0;
const optionIdentities = new WeakMap<object, number>();
const scopeCacheLimit = 64;
type ImportScope = { key: string; handle: NamespacedUnregister; pending: number; successful: boolean };
const importScopes = new Map<string, ImportScope>();
const retainedScopes = new Map<string, ImportScope>();

const findImportScope = (key: string) => importScopes.get(key) ?? retainedScopes.get(key);

const getOptionIdentity = (option: object | undefined) => {
	if (!option) { return 0 }
	let identity = optionIdentities.get(option);
	if (identity === undefined) {
		identity = nextOptionIdentity += 1;
		optionIdentities.set(option, identity);
	}
	return identity;
};

const finishImport = (scope: ImportScope, successful: boolean) => {
	scope.pending -= 1;
	scope.successful ||= successful;
	if (successful) { retainedScopes.set(scope.key, scope) }
	if (scope.pending === 0 && !scope.successful) {
		if (importScopes.get(scope.key) === scope) { importScopes.delete(scope.key) }
		scope.handle.unregister();
	}
	if (importScopes.size <= scopeCacheLimit) { return }
	for (const [cachedKey, cachedScope] of importScopes) {
		if (importScopes.size <= scopeCacheLimit) { break }
		if (cachedScope.pending === 0) { importScopes.delete(cachedKey) }
	}
};

export { register };
export const tsImport: ModuleImport = <TModule extends object = ModuleNamespace>(specifier: string, options: string | TsImportOptions) => {
	if (!options || (typeof options === 'object' && !options.parentURL)) {
		throw new Error('The current file path (import.meta.url) must be provided in the second argument of tsImport()');
	}

	if (typeof options === 'string') { options = { parentURL: options } }

	const tsconfigOption = options.tsconfig ?? process.env['TSNODE_TSCONFIG_PATH'];
	const tsconfig = tsconfigOption === false ? false : resolve(tsconfigOption ?? 'tsconfig.json');
	const key = Json.serialize([tsconfig === false ? false : getTsconfigCacheKey(tsconfig), getOptionIdentity(options.onImport), getOptionIdentity(options.virtualSources)]);
	let scope = findImportScope(key);
	if (!scope) {
		scope = { key, handle: registerScoped({ ...options, tsconfig, namespace: `tsImport-${nextImportNamespace += 1}` }), pending: 0, successful: false };
		importScopes.set(key, scope);
	} else {
		importScopes.delete(key);
		importScopes.set(key, scope);
	}
	scope.pending += 1;
	const currentScope = scope;
	try {
		return scope.handle.import<TModule>(specifier, options.parentURL).then(module => {
			finishImport(currentScope, true);
			return module;
		}, (error: unknown) => {
			finishImport(currentScope, false);
			throw error;
		});
	} catch (error) {
		finishImport(currentScope, false);
		throw error;
	}
};

export type { ModuleNamespace, NamespacedUnregister, OnImport, Register, RegisterHandle, RegisterOptions, ScopedImport, ModuleImport, TsImportOptions, Unregister } from '../types';
