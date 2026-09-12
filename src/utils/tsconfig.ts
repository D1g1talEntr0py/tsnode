import path from 'node:path';
import { readJsonFileSync } from './read-json-file';
import type { ParsedTsconfig } from '../types';

type TypeScriptCompilerOptions = {
	paths?: Record<string, string[]>;
	baseUrl?: string;
	allowJs?: boolean;
};

type TypeScriptOptions = {
	compilerOptions?: TypeScriptCompilerOptions;
};

// Cache misses use a sentinel so loadTsconfig can do a single Map.get() lookup.
const missingTsconfig = Symbol('missing-tsconfig');
const tsconfigCache = new Map<string, ParsedTsconfig | typeof missingTsconfig>();

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

const decodeTypeScriptOptions = (value: unknown): TypeScriptOptions | undefined => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) { return undefined }
	if (!('compilerOptions' in value) || value.compilerOptions === undefined) { return {} }

	const compilerOptions = value.compilerOptions;
	if (compilerOptions === null || typeof compilerOptions !== 'object' || Array.isArray(compilerOptions)) { return undefined }
	if ('baseUrl' in compilerOptions && compilerOptions.baseUrl !== undefined && typeof compilerOptions.baseUrl !== 'string') { return undefined }
	if ('allowJs' in compilerOptions && compilerOptions.allowJs !== undefined && typeof compilerOptions.allowJs !== 'boolean') { return undefined }
	if ('paths' in compilerOptions && compilerOptions.paths !== undefined) {
		if (compilerOptions.paths === null || typeof compilerOptions.paths !== 'object' || Array.isArray(compilerOptions.paths)) { return undefined }
		if (!Object.values(compilerOptions.paths).every(isStringArray)) { return undefined }
	}

	return { compilerOptions };
};

const readTsconfig = (configPath: string): ParsedTsconfig | undefined => {
	const tsconfig = readJsonFileSync(configPath, decodeTypeScriptOptions);
	if (!tsconfig) { return undefined }

	const { compilerOptions: { baseUrl, paths = {}, allowJs = false } = {} } = tsconfig;

	return { compilerOptions: { allowJs, baseUrl: path.resolve(path.dirname(configPath), baseUrl || '.'), paths } };
};

export const resolveTsconfigPaths = (tsconfig: ParsedTsconfig, specifier: string) => {
	const resolved: string[] = [];
	const { baseUrl, paths } = tsconfig.compilerOptions;

	for (const [ alias, targets ] of Object.entries(paths)) {
		const wildcardIndex = alias.indexOf('*');

		if (wildcardIndex === -1 && specifier !== alias) { continue }

		let matched: string;
		if (wildcardIndex !== -1) {
			const prefix = alias.slice(0, wildcardIndex);
			const suffix = alias.slice(wildcardIndex + 1);
			if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
				continue;
			}

			matched = specifier.slice(prefix.length, specifier.length - suffix.length);
		} else {
			matched = '';
		}

		for (const target of targets) {
			resolved.push(path.resolve(baseUrl, target.replaceAll('*', matched)));
		}
	}

	return resolved;
};

export const isFileIncluded = (_tsconfig: ParsedTsconfig, _filePath: string) => true;

// Keep cache keys path-based so tsconfig lookups remain metadata-free on the hot path.
export const getTsconfigCacheKey = (configPath = 'tsconfig.json') => path.resolve(configPath);

export const loadTsconfig = (configPath = 'tsconfig.json'): ParsedTsconfig | undefined => {
	const resolvedConfigPath = path.resolve(configPath);
	const cached = tsconfigCache.get(resolvedConfigPath);
	if (cached !== undefined) { return cached === missingTsconfig ? undefined : cached }

	const loaded = readTsconfig(resolvedConfigPath);
	tsconfigCache.set(resolvedConfigPath, loaded ?? missingTsconfig);

	return loaded;
};
