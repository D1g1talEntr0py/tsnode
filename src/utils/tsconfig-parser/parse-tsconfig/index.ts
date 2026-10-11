import path from 'node:path';
import type { CompilerOptions, TypeScriptConfig, TypeScriptOptions, Cache, ParseTsconfigOptions } from '../types';
import { normalizeRelativePath } from '../utils/normalize-relative-path';
import { toPosixPath } from '../utils/to-posix-path';
import { readJsonc } from '../utils/read-jsonc';
import { implicitBaseUrlSymbol, configDirPlaceholder } from '../utils/constants';
import { getTypeScriptSemantics, type TypeScriptSemanticsConfiguration } from '../utils/typescript-semantics';
import { resolveExtendsPath } from './resolve-extends-path';

const pathRelative = (from: string, to: string) => normalizeRelativePath(path.relative(from, to));

const filesProperties = [
	'files',
	'include',
	'exclude'
] as const;

const outputFileFields = [
	'outFile',
	'tsBuildInfoFile'
] as const;

/**
 * Resolves a path from extended config to canonical form relative to parent config.
 * TypeScript normalizes these paths: nested/../. → .
 * Used for: baseUrl, outDir, rootDir, declarationDir
 * @param fromDirectoryPath - Directory of the extending config.
 * @param extendsDirectoryPath - Directory of the extended config.
 * @param filePath - Path relative to the extended config.
 */
const resolveAndRelativize = (fromDirectoryPath: string, extendsDirectoryPath: string, filePath: string) => {
	return toPosixPath(path.relative(fromDirectoryPath, path.join(extendsDirectoryPath, filePath))) || './';
};

/**
 * Prefixes a pattern with relative directory path without normalization.
 * TypeScript literally prefixes: nested/../. stays as nested/../.
 * Used for: files, include, exclude patterns
 * @param fromDirectoryPath - Directory of the extending config.
 * @param extendsDirectoryPath - Directory of the extended config.
 * @param pattern - File pattern from the extended config.
 */
const prefixPattern = (fromDirectoryPath: string, extendsDirectoryPath: string, pattern: string) => {
	const relativeDir = path.relative(fromDirectoryPath, extendsDirectoryPath);

	// Remove leading ./ from pattern to avoid double prefix like ./some-dir/./file.ts
	return relativeDir ? toPosixPath(`${relativeDir}/${pattern.startsWith('./') ? pattern.slice(2) : pattern}`) : pattern;
};

const resolveExtends = (extendsPath: string, fromDirectoryPath: string, circularExtendsTracker: Set<string>, semantics: TypeScriptSemanticsConfiguration, cache?: Cache) => {
	const resolvedExtendsPath = resolveExtendsPath(extendsPath, fromDirectoryPath, cache);

	if (!resolvedExtendsPath) { throw new Error(`File '${extendsPath}' not found.`) }

	if (circularExtendsTracker.has(resolvedExtendsPath)) {
		throw new Error(`Circularity detected while resolving configuration: ${resolvedExtendsPath}`);
	}

	circularExtendsTracker.add(resolvedExtendsPath);

	const extendsDirectoryPath = path.dirname(resolvedExtendsPath);
	const extendsConfig = _parseTsconfig(resolvedExtendsPath, semantics, cache, circularExtendsTracker, true);
	delete extendsConfig.references;

	const { compilerOptions } = extendsConfig;
	if (compilerOptions) {
		const { baseUrl } = compilerOptions;
		if (baseUrl && !baseUrl.startsWith(configDirPlaceholder)) {
			compilerOptions.baseUrl = resolveAndRelativize(fromDirectoryPath, extendsDirectoryPath, baseUrl);
		}

		const { outDir } = compilerOptions;
		if (outDir && !outDir.startsWith(configDirPlaceholder)) {
			compilerOptions.outDir = resolveAndRelativize(fromDirectoryPath, extendsDirectoryPath, outDir);
		}

		const { declarationDir } = compilerOptions;
		if (declarationDir && !declarationDir.startsWith(configDirPlaceholder)) {
			compilerOptions.declarationDir = resolveAndRelativize(fromDirectoryPath, extendsDirectoryPath, declarationDir);
		}

		const { rootDir } = compilerOptions;
		if (rootDir && !rootDir.startsWith(configDirPlaceholder)) {
			compilerOptions.rootDir = resolveAndRelativize(fromDirectoryPath, extendsDirectoryPath, rootDir);
		}

		for (const outputFileField of outputFileFields) {
			const outputFile = compilerOptions[outputFileField];
			if (outputFile && !outputFile.startsWith(configDirPlaceholder)) {
				compilerOptions[outputFileField] = resolveAndRelativize(fromDirectoryPath, extendsDirectoryPath, outputFile);
			}
		}

		const { rootDirs } = compilerOptions;
		if (rootDirs) {
			compilerOptions.rootDirs = rootDirs.map(dir => (dir.startsWith(configDirPlaceholder) ? dir : resolveAndRelativize(fromDirectoryPath, extendsDirectoryPath, dir)));
		}

		const { typeRoots } = compilerOptions;
		if (typeRoots) {
			compilerOptions.typeRoots = typeRoots.map(root => (root.startsWith(configDirPlaceholder) ? root : resolveAndRelativize(fromDirectoryPath, extendsDirectoryPath, root)));
		}
	}

	for (const property of filesProperties) {
		const filesList = extendsConfig[property];
		if (filesList) {
			extendsConfig[property] = filesList.map((file) => {
				if (file.startsWith(configDirPlaceholder)) { return file }

				return prefixPattern(fromDirectoryPath, extendsDirectoryPath, file);
			});
		}
	}

	return extendsConfig;
};

const outputFields = [
	'outDir',
	'declarationDir'
] as const;

/**
 * The default `exclude` comes from the effective `outDir` and `declarationDir`,
 * so it can only be derived after `extends` is merged. Deriving it in an
 * extended config would leak into the extending config as an explicit `exclude`.
 * @param tsconfigPath The path to the tsconfig file being parsed.
 * @param semantics The TypeScript semantics configuration.
 * @param cache Optional cache for file system reads.
 * @param circularExtendsTracker Tracks circular references in extends.
 * @param isExtendedConfig Indicates if the config is an extended config.
 * @returns The resolved and merged tsconfig object.
 */
const _parseTsconfig = (tsconfigPath: string, semantics: TypeScriptSemanticsConfiguration, cache?: Cache, circularExtendsTracker = new Set<string>(), isExtendedConfig = false): TypeScriptOptions => {
	/**
	 * Decided not to cache the TsConfigJsonResolved object because it's
	 * mutable.
	 *
	 * Note how `resolveExtends` can call `parseTsconfig` recursively
	 * and actually mutates the object. It can also be mutated in
	 * user-land.
	 *
	 * By only caching fs results, we can avoid serving mutated objects
	 */
	let config: TypeScriptConfig;
	try {
		config = readJsonc(tsconfigPath, cache) as TypeScriptConfig;
	} catch (error) {
		throw new Error(`Cannot resolve tsconfig at path: ${tsconfigPath}`, { cause: error });
	}

	const directoryPath = path.dirname(tsconfigPath);

	if (config.compilerOptions) {
		const { compilerOptions } = config;
		if (compilerOptions.paths && (!compilerOptions.baseUrl || !semantics.baseUrlResolution)) {
			type WithImplicitBaseUrl = CompilerOptions & {
				[implicitBaseUrlSymbol]: string;
			};
			(compilerOptions as WithImplicitBaseUrl)[implicitBaseUrlSymbol] = directoryPath;
		}
	}

	if (config.extends) {
		const extendsPathList = (Array.isArray(config.extends) ? config.extends : [config.extends]);

		delete config.extends;

		for (const extendsPath of extendsPathList.toReversed()) {
			const extendsConfig = resolveExtends(extendsPath, directoryPath, new Set(circularExtendsTracker), semantics, cache);
			const merged = {
				...extendsConfig,
				...config,

				compilerOptions: {
					...extendsConfig.compilerOptions,
					...config.compilerOptions
				}
			};

			if (extendsConfig.watchOptions) {
				merged.watchOptions = {
					...extendsConfig.watchOptions,
					...config.watchOptions
				};
			}
			config = merged;
		}
	}

	if (config.compilerOptions) {
		const { compilerOptions } = config;
		const normalizedPaths = [
			'baseUrl',
			'rootDir',
			...outputFields,
			...outputFileFields
		] as const;

		for (const property of normalizedPaths) {
			const unresolvedPath = compilerOptions[property];
			if (unresolvedPath && !unresolvedPath.startsWith(configDirPlaceholder)) {
				compilerOptions[property] = pathRelative(directoryPath, path.resolve(directoryPath, unresolvedPath));
			}
		}

		for (const property of [ 'rootDirs', 'typeRoots' ] as const) {
			const unresolvedPaths = compilerOptions[property];
			if (unresolvedPaths) {
				compilerOptions[property] = unresolvedPaths.map(unresolvedPath => (unresolvedPath.startsWith(configDirPlaceholder) ? unresolvedPath : pathRelative(directoryPath, path.resolve(directoryPath, unresolvedPath))));
			}
		}

		if (!isExtendedConfig && !Array.isArray(config.exclude)) {
			const outputPaths = outputFields.map((field) => compilerOptions[field]).filter(Boolean) as string[];

			// tsc derives the default exclude from the resolved absolute output paths
			if (outputPaths.length > 0) {
				config.exclude = outputPaths.map(outputPath => toPosixPath(path.resolve(directoryPath, interpolateConfigDir(outputPath, directoryPath) ?? outputPath)));
			}
		}
	} else {
		config.compilerOptions = {};
	}

	if (config.include) {
		config.include = config.include.map(toPosixPath);
	}

	if (config.files) {
		config.files = config.files.map(file => (
			file.startsWith(configDirPlaceholder)
				? file
				: normalizeRelativePath(file)
		));
	}

	if (config.watchOptions) {
		const { watchOptions } = config;

		if (watchOptions.excludeDirectories) {
			watchOptions.excludeDirectories = watchOptions.excludeDirectories.map(
				excludePath => toPosixPath(path.resolve(directoryPath, excludePath))
			);
		}

		if (watchOptions.excludeFiles) {
			watchOptions.excludeFiles = watchOptions.excludeFiles.map(
				excludePath => toPosixPath(path.resolve(directoryPath, excludePath))
			);
		}

		if (watchOptions.watchFile) {
			watchOptions.watchFile = watchOptions.watchFile.toLowerCase();
		}

		if (watchOptions.watchDirectory) {
			watchOptions.watchDirectory = watchOptions.watchDirectory.toLowerCase();
		}

		if (watchOptions.fallbackPolling) {
			watchOptions.fallbackPolling = watchOptions.fallbackPolling.toLowerCase();
		}
	}

	return config;
};

const interpolateConfigDir = (
	filePath: string,
	configDir: string
) => {
	if (filePath.startsWith(configDirPlaceholder)) {
		return toPosixPath(path.join(configDir, filePath.slice(configDirPlaceholder.length)));
	}

	return undefined;
};

/**
 * @see https://github.com/microsoft/TypeScript/issues/57485#issuecomment-2027787456
 * exclude paths, as it requires custom processing
 */
const compilerFieldsWithConfigDir = [
	'outDir',
	'declarationDir',
	'outFile',
	'rootDir',
	'baseUrl',
	'tsBuildInfoFile'
] as const;

const normalizeCompilerOptions = (compilerOptions: CompilerOptions, semantics: TypeScriptSemanticsConfiguration) => {
	for (const option of semantics.removedCompilerOptions) { Reflect.deleteProperty(compilerOptions, option) }

	if (compilerOptions.target) {
		let target = compilerOptions.target.toLowerCase();

		if (target === 'es2015') { target = 'es6' }

		// Lower case
		compilerOptions.target = target;

		if (semantics.removedTargets.includes(target)) {
			delete compilerOptions.target;
		}
	}

	if (compilerOptions.module) {
		let module = compilerOptions.module.toLowerCase();

		if (module === 'es2015') { module = 'es6' }

		compilerOptions.module = module;

		if (semantics.removedModules.includes(module)) {
			delete compilerOptions.module;
		}
	}

	if (compilerOptions.moduleResolution) {
		let moduleResolution = compilerOptions.moduleResolution.toLowerCase();

		if (moduleResolution === 'node' || moduleResolution === 'node10') {
			moduleResolution = semantics.node10ModuleResolution;
		}

		compilerOptions.moduleResolution = moduleResolution;
	}

	if (compilerOptions.jsx) {
		compilerOptions.jsx = compilerOptions.jsx.toLowerCase() as NonNullable<CompilerOptions['jsx']>;
	}

	if (compilerOptions.moduleDetection) {
		compilerOptions.moduleDetection = compilerOptions.moduleDetection.toLowerCase();
	}

	if (compilerOptions.importsNotUsedAsValues) {
		compilerOptions.importsNotUsedAsValues = compilerOptions.importsNotUsedAsValues.toLowerCase() as NonNullable<CompilerOptions['importsNotUsedAsValues']>;
	}

	if (compilerOptions.newLine) {
		compilerOptions.newLine = compilerOptions.newLine.toLowerCase();
	}

	if (compilerOptions.lib) {
		compilerOptions.lib = compilerOptions.lib.map((library) => library.toLowerCase());
	}
};

/**
 * Parses a tsconfig file at a given path
 *
 * @param tsconfigPath - Path to the tsconfig file.
 * @param options - Parse options.
 * @param options.cache - Cache for file system reads (default: new `Map()`).
 * @param options.typeScriptVersion - TypeScript major version whose semantics to apply (default: `6`).
 * @returns The parsed and resolved tsconfig JSON.
 */
export const parseTsconfig = (tsconfigPath: string,	{ cache = new Map(), typeScriptVersion }: ParseTsconfigOptions = {}): TypeScriptOptions => {
	const semantics = getTypeScriptSemantics(typeScriptVersion);
	const resolvedTsconfigPath = path.resolve(tsconfigPath);
	const config = _parseTsconfig(resolvedTsconfigPath, semantics, cache);
	const configDir = path.dirname(resolvedTsconfigPath);

	const { compilerOptions } = config;
	if (compilerOptions) {
		for (const property of compilerFieldsWithConfigDir) {
			const value = compilerOptions[property];
			if (value) {
				const resolvedPath = interpolateConfigDir(value, configDir);
				compilerOptions[property] = resolvedPath ? pathRelative(configDir, resolvedPath) : value;
			}
		}

		for (const property of [ 'rootDirs', 'typeRoots' ] as const) {
			const value = compilerOptions[property];
			if (value) {
				compilerOptions[property] = value.map((v) => {
					const resolvedPath = interpolateConfigDir(v, configDir);

					return resolvedPath ? pathRelative(configDir, resolvedPath) : normalizeRelativePath(v);
				});
			}
		}

		const { paths } = compilerOptions;
		if (paths) {
			for (const [ name, substitutions ] of Object.entries(paths)) {
				paths[name] = substitutions.map((filePath) => interpolateConfigDir(filePath, configDir) ?? filePath);
			}
		}

		normalizeCompilerOptions(compilerOptions, semantics);
	}

	for (const property of filesProperties) {
		const value = config[property];
		if (value) {
			config[property] = value.map((filePath) => interpolateConfigDir(filePath, configDir) ?? filePath);
		}
	}

	return config;
};
