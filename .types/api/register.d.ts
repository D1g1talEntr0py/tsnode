import type { RegisterOptions, RequiredProperty, RegisterHandle, NamespacedUnregister } from '../types';
export declare function register(options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister;
export declare function register(options?: RegisterOptions): RegisterHandle;
