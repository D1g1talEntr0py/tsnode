import { register } from './register';
import type { TsconfigOptions } from '../types';

type Options = { parentURL: string, onImport?: (url: string) => void, tsconfig?: TsconfigOptions };

export { register };
export const tsImport = (specifier: string, options: string | Options) => {
	if (!options || (typeof options === 'object' && !options.parentURL)) {
		throw new Error('The current file path (import.meta.url) must be provided in the second argument of tsImport()');
	}

	if (typeof options === 'string') { options = { parentURL: options } }

	// We don't want to unregister this after load since there can be child import() calls that need TS support.
	// This is not accessible to others because of the namespace.
	return register({ ...options, namespace: Date.now().toString() }).import(specifier, options.parentURL);
};

export type { NamespacedUnregister, Register, RegisterHandle, RegisterOptions, Unregister } from '../types';
