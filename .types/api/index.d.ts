import { register } from './register';
import type { TsconfigOptions } from '../types';
type Options = {
    parentURL: string;
    onImport?: (url: string) => void;
    tsconfig?: TsconfigOptions;
};
export { register };
export declare const tsImport: (specifier: string, options: string | Options) => Promise<any>;
export type { NamespacedUnregister, Register, RegisterHandle, RegisterOptions, Unregister } from '../types';
