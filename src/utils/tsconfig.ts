import { dirname, isAbsolute, resolve } from 'node:path';
import { createPathsMatcher, parseTsconfig, type PathsMatcher } from './tsconfig-parser';
import type { TypeScriptConfiguration } from '../types';

const identitySourceLimit = 64;
const tsconfigCacheLimit = 64;
const tsconfigCache = new Map<string, { identity: string; configuration: TypeScriptConfiguration }>();
const configIdentities = new WeakMap<TypeScriptConfiguration, string>();
const pathMatchers = new WeakMap<TypeScriptConfiguration, PathsMatcher | null>();

export const resolveTsconfigPaths = (configuration: TypeScriptConfiguration, specifier: string) => {
	return pathMatchers.get(configuration)?.(specifier) ?? [];
};

export const isFileIncluded = (_configuration: TypeScriptConfiguration, _filePath: string) => true;

export const getTsconfigCacheKey = (configPath = 'tsconfig.json', configuration = loadTsconfig(configPath)) => configuration ? configIdentities.get(configuration) ?? JSON.stringify(configuration) : `${resolve(configPath)}\0missing`;

export const loadTsconfig = (configPath = 'tsconfig.json'): TypeScriptConfiguration | undefined => {
	const resolvedConfigPath = resolve(configPath);
	const fileCache = new Map<string, string>();

	try {
		const compilerOptions = parseTsconfig(resolvedConfigPath, { cache: fileCache }).compilerOptions ?? {};

		const sources: [string, string][] = [];
		for (const [ key, source ] of fileCache) {
			if (key.startsWith('readFileSync:')) { sources.push([ key, source ]) }
		}

		if (sources.length > identitySourceLimit) { throw new Error('Invalid tsconfig') }

		const identity = JSON.stringify(sources);
		const cached = tsconfigCache.get(resolvedConfigPath);

		if (cached?.identity === identity) { return cached.configuration }

		const paths: Record<string, string[]> = {};
		for (const [ alias, targets ] of Object.entries(compilerOptions.paths ?? {})) {
			for (const target of targets) {
				(paths[alias] ??= []).push(isAbsolute(target) || target.startsWith('.') ? target : `./${target}`);
			}
		}

		const configuration = { compilerOptions: { ...compilerOptions, allowJs: compilerOptions.allowJs ?? false, paths } };

		if (compilerOptions.baseUrl !== undefined) {
			configuration.compilerOptions.baseUrl = resolve(dirname(resolvedConfigPath), compilerOptions.baseUrl);
		}

		configIdentities.set(configuration, identity);
		pathMatchers.set(configuration, createPathsMatcher({ path: resolvedConfigPath, config: configuration }));

		tsconfigCache.delete(resolvedConfigPath);
		tsconfigCache.set(resolvedConfigPath, { identity, configuration });

		if (tsconfigCache.size > tsconfigCacheLimit) { tsconfigCache.delete(tsconfigCache.keys().next().value!) }

		return configuration;
	} catch {
		tsconfigCache.delete(resolvedConfigPath);

		return undefined;
	}
};
