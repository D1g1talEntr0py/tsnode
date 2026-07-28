import path from 'node:path';
import { readJsonFileSync } from './read-json-file';

type TypeScriptCompilerOptions = {
	paths?: Record<string, string[]>;
	baseUrl?: string;
	allowJs?: boolean;
};

type TypeScriptOptions = {
	compilerOptions?: TypeScriptCompilerOptions;
};

type TypeScriptConfig = Required<TypeScriptOptions> & { compilerOptions: Required<TypeScriptCompilerOptions> };

// Cache misses use a sentinel so loadTsconfig can do a single Map.get() lookup.
const missingTsconfig = Symbol('missing-tsconfig');
const tsconfigCache = new Map<string, TypeScriptConfig | typeof missingTsconfig>();

const readTsconfig = (configPath: string): TypeScriptConfig | undefined => {
	const tsconfig = readJsonFileSync<TypeScriptOptions>(configPath);
	if (!tsconfig) { return undefined }

	const { compilerOptions: { baseUrl, paths = {}, allowJs = false } = {} } = tsconfig;

	return { compilerOptions: { allowJs, baseUrl: path.resolve(path.dirname(configPath), baseUrl || '.'), paths } };
};

export const resolveTsconfigPaths = (tsconfig: TypeScriptConfig, specifier: string) => {
	const resolved: string[] = [];
	const { baseUrl, paths } = tsconfig.compilerOptions;

	for (const [ alias, targets ] of Object.entries(paths)) {
		const wildcardIndex = alias.indexOf('*');

		if (wildcardIndex === -1 && specifier !== alias) { continue }

		let matched = wildcardIndex === -1 ? '' : undefined;
		if (wildcardIndex !== -1) {
			const prefix = alias.slice(0, wildcardIndex);
			const suffix = alias.slice(wildcardIndex + 1);
			if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
				continue;
			}

			matched = specifier.slice(prefix.length, specifier.length - suffix.length);
		}

		for (const target of targets) {
			resolved.push(path.resolve(baseUrl, target.replaceAll('*', matched!)));
		}
	}

	return resolved;
};

export const isFileIncluded = (_tsconfig: TypeScriptConfig, _filePath: string) => true;

// Keep cache keys path-based so tsconfig lookups remain metadata-free on the hot path.
export const getTsconfigCacheKey = (configPath = 'tsconfig.json') => path.resolve(configPath);

export const loadTsconfig = (configPath = 'tsconfig.json'): TypeScriptConfig | undefined => {
	const resolvedConfigPath = path.resolve(configPath);
	const cached = tsconfigCache.get(resolvedConfigPath);
	if (cached !== undefined) { return cached === missingTsconfig ? undefined : cached }

	const loaded = readTsconfig(resolvedConfigPath);
	tsconfigCache.set(resolvedConfigPath, loaded ?? missingTsconfig);

	return loaded;
};
