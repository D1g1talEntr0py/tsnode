import { register, registerScoped } from './register';
import type { ModuleNamespace, ModuleImport, TsImportOptions } from '../types';

let nextImportNamespace = 0;

export { register };
export const tsImport: ModuleImport = <TModule extends object = ModuleNamespace>(specifier: string, options: string | TsImportOptions) => {
	if (!options || (typeof options === 'object' && !options.parentURL)) {
		throw new Error('The current file path (import.meta.url) must be provided in the second argument of tsImport()');
	}

	if (typeof options === 'string') { options = { parentURL: options } }

	// We don't want to unregister this after load since there can be child import() calls that need TS support.
	// This is not accessible to others because of the namespace.
	return registerScoped({ ...options, namespace: `tsImport-${nextImportNamespace += 1}` }).import<TModule>(specifier, options.parentURL);
};

export type { ModuleNamespace, NamespacedUnregister, Register, RegisterHandle, RegisterOptions, ScopedImport, ModuleImport, TsImportOptions, Unregister } from '../types';
