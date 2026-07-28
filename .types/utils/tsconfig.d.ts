type TypeScriptCompilerOptions = {
    paths?: Record<string, string[]>;
    baseUrl?: string;
    allowJs?: boolean;
};
type TypeScriptOptions = {
    compilerOptions?: TypeScriptCompilerOptions;
};
type TypeScriptConfig = Required<TypeScriptOptions> & {
    compilerOptions: Required<TypeScriptCompilerOptions>;
};
export declare const resolveTsconfigPaths: (tsconfig: TypeScriptConfig, specifier: string) => string[];
export declare const isFileIncluded: (_tsconfig: TypeScriptConfig, _filePath: string) => boolean;
export declare const getTsconfigCacheKey: (configPath?: string) => string;
export declare const loadTsconfig: (configPath?: string) => TypeScriptConfig | undefined;
export {};
