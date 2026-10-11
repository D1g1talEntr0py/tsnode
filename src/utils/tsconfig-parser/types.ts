import type { TsconfigRaw } from 'esbuild';
import type { TypeScriptVersion } from './utils/typescript-semantics';

export type { TypeScriptVersion };

/**
 * Compiler options esbuild understands, plus the path-like and enum options the parser
 * normalizes. Anything else is passed through untouched.
 */
export interface CompilerOptions extends NonNullable<TsconfigRaw['compilerOptions']> {
	[option: string]: unknown;
	allowJs?: boolean;
	declarationDir?: string;
	lib?: string[];
	module?: string;
	moduleDetection?: string;
	moduleResolution?: string;
	newLine?: string;
	outDir?: string;
	outFile?: string;
	rootDir?: string;
	rootDirs?: string[];
	tsBuildInfoFile?: string;
	typeRoots?: string[];
}

export type WatchOptions = {
	[option: string]: unknown;
	excludeDirectories?: string[];
	excludeFiles?: string[];
	fallbackPolling?: string;
	watchDirectory?: string;
	watchFile?: string;
};

/** A tsconfig after `extends` has been merged; unknown top-level fields are preserved. */
export type TsConfigJsonResolved = {
	[field: string]: unknown;
	compilerOptions?: CompilerOptions;
	exclude?: string[];
	files?: string[];
	include?: string[];
	references?: { path: string }[];
	watchOptions?: WatchOptions;
};

/** The subset of tsconfig.json the parser reads. */
export type TsConfigJson = TsConfigJsonResolved & { extends?: string | string[] };

export type TsConfigResult = {

	/**
	 * The path to the tsconfig.json file
	 */
	path: string;

	/**
	 * The resolved tsconfig.json file
	 */
	config: TsConfigJsonResolved;
};

export type PathsMatcher = (specifier: string) => string[];

export type Cache<value = unknown> = Map<string, value>;

export type ParseTsconfigOptions = {

	/**
	 * Cache for file system reads (default: new `Map()`).
	 */
	cache?: Cache | undefined;

	/**
	 * TypeScript major version whose semantics to apply (default: `6`).
	 */
	typeScriptVersion?: TypeScriptVersion | undefined;
};

export type PathsMatcherOptions = {

	/**
	 * TypeScript major version whose semantics to apply (default: `6`).
	 */
	typeScriptVersion?: TypeScriptVersion | undefined;
};
