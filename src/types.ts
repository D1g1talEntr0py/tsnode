export type NodeError = Error & {
	code: string;
	url?: string;
	path?: string;
};

export type TsnodeRequest = {
	namespace: string;
	parentURL: string;
	specifier: string;
};

export type TsconfigOptions = false | string;

export type RegisterOptions = {
	namespace?: string;
	onImport?: (url: string) => void;
	tsconfig?: TsconfigOptions;
};

export type Unregister = () => Promise<void>;

export type ScopedImport = (specifier: string, parent: string) => Promise<any>;

export type RegisterHandle = {
	unregister: Unregister;
	import?: ScopedImport;
};

export type NamespacedUnregister = RegisterHandle & {
	import: ScopedImport;
};

export type Register = {
	(options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister;
	(options?: RegisterOptions): RegisterHandle;
};

export type RequiredProperty<Type, Keys extends keyof Type> = Type & { [P in Keys]-?: Type[P] };