import type { TransformOptions, TsconfigRaw } from 'esbuild';

type Expand<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

export type NodeError = Error & {
	code: string;
	url?: string;
	path?: string;
};

export type ModuleRequest = {
	namespace: string;
	parentURL: string;
	specifier: string;
};

export type TsconfigOptions = false | string;

export type OnImport = (url: string) => void;

export type RegisterOptions = {
	namespace?: string | undefined;
	onImport?: OnImport | undefined;
	virtualSources?: Map<string, string> | undefined;
	tsconfig?: TsconfigOptions | undefined;
};

export type RunOptions = {
	noCache?: boolean;
	signalRelay?: boolean;
	tsconfigPath?: string | undefined;
	ipc?: boolean;
};

export type FlagDefinition = {
	type: BooleanConstructor | StringConstructor | NumberConstructor | [StringConstructor];
	alias?: string;
};

export type Flags = Record<string, FlagDefinition>;

export type DependencyMessage = {
	type: 'dependency';
	path: string;
};

export type SendToParent = (data: Record<string, unknown>) => void;

export type Parent = {
	send: SendToParent | void;
};

export type SourceMap = {
	version: number;
	sources: string[];
	names: string[];
	mappings: string;
	sourcesContent?: string[];
	sourceRoot?: string;
	file?: string;
};

export type Transformed = {
	code: string;
	map?: SourceMap | undefined;
};

export type CachedTransformOptions = Expand<TransformOptions & {
	tsconfigHash?: string | undefined;
	getTsconfigRaw?: () => TransformOptions['tsconfigRaw'];
	tsconfigSnapshot?: { raw: TransformOptions['tsconfigRaw']; serialized: string; identity?: string };
}>;

export type ParsedTsconfig = {
	compilerOptions: {
		paths: Record<string, string[]>;
		baseUrl: string;
		allowJs: boolean;
	};
};

export type TypeScriptConfiguration = Readonly<{
	compilerOptions: Readonly<Omit<NonNullable<TsconfigRaw['compilerOptions']>, 'paths'> & {
		paths: Readonly<Record<string, readonly string[]>>;
		allowJs: boolean;
	}>;
}>;

export type HookData = {
	active: boolean;
	hasLoadedTsconfig: boolean;
	namespace: string | undefined;
	onImport: OnImport | undefined;
	virtualSources: Map<string, string> | undefined;
	parsedTsconfig: ParsedTsconfig | undefined;
	tsconfig: TsconfigOptions | undefined;
};

export type Unregister = () => void;

export type ModuleNamespace = Record<string, unknown>;

export type ScopedImport = <Module extends object = ModuleNamespace>(specifier: string, parent: string) => Promise<Module>;

export type DynamicImport = <Module extends object = ModuleNamespace>(specifier: string) => Promise<Module>;

export type TsImportOptions = {
	parentURL: string;
	onImport?: RegisterOptions['onImport'];
	virtualSources?: RegisterOptions['virtualSources'];
	tsconfig?: RegisterOptions['tsconfig'];
};

export type ModuleImport = <Module extends object = ModuleNamespace>(specifier: string, options: string | TsImportOptions) => Promise<Module>;

export type RegisterHandle = {
	unregister: Unregister;
	[Symbol.dispose]: Unregister;
	import?: ScopedImport;
};

export type NamespacedUnregister = Expand<RegisterHandle & {
	import: ScopedImport;
}>;

export type Register = {
	(options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister;
	(options?: RegisterOptions): RegisterHandle;
};

export type RequiredProperty<Type, Keys extends keyof Type> = Type & { [P in Keys]-?: Exclude<Type[P], undefined> };