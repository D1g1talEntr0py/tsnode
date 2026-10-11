import path from 'node:path';
import type { TsConfigResult, PathsMatcher, PathsMatcherOptions } from '../types';
import { isRelativePathPattern } from '../utils/is-relative-path-pattern';
import { toPosixPath } from '../utils/to-posix-path';
import { implicitBaseUrlSymbol } from '../utils/constants';
import { getTypeScriptSemantics, type TypeScriptSemanticsConfiguration } from '../utils/typescript-semantics';
import {
	assertStarCount,
	parsePattern,
	isPatternMatch
} from './utils';
import type { StarPattern, PathEntry } from './types';

const parsePaths = (
	paths: Partial<Record<string, string[]>>,
	baseUrl: string | undefined,
	absoluteBaseUrl: string,
	semantics: TypeScriptSemanticsConfiguration
) => Object.entries(paths).map(([pattern, substitutions]) => {
	assertStarCount(pattern, `Pattern '${pattern}' can have at most one '*' character.`);

	return {
		pattern: parsePattern(pattern),
		substitutions: substitutions!.map((substitution) => {
			assertStarCount(
				substitution,
				`Substitution '${substitution}' in pattern '${pattern}' can have at most one '*' character.`
			);

			if (!isRelativePathPattern.test(substitution) && !path.isAbsolute(substitution)) {
				if (semantics.alwaysRejectNonRelativeSubstitutions) { throw new Error('Non-relative paths are not allowed. Did you forget a leading \'./\'?') }

				if (!baseUrl) { throw new Error('Non-relative paths are not allowed when \'baseUrl\' is not set. Did you forget a leading \'./\'?') }
			}

			return path.resolve(absoluteBaseUrl, substitution);
		})
	};
});

/**
 * Reference:
 * https://github.com/microsoft/TypeScript/blob/3ccbe804f850f40d228d3c875be952d94d39aa1d/src/compiler/moduleNameResolver.ts#L2465
 * @param tsconfig - Resolved config and its file path.
 * @param options - Matcher options.
 * @param options.typeScriptVersion - TypeScript major version whose semantics to apply (default: `6`).
 * @returns A matcher returning candidate paths for a specifier, or `null` when no `paths` (or TS6 `baseUrl`) apply.
 */
export const createPathsMatcher = (
	tsconfig: TsConfigResult,
	{ typeScriptVersion }: PathsMatcherOptions = {}
): PathsMatcher | null => {
	const semantics = getTypeScriptSemantics(typeScriptVersion);
	const { compilerOptions } = tsconfig.config;
	if (!compilerOptions) {
		return null;
	}

	const { paths } = compilerOptions;
	const baseUrl = semantics.baseUrlResolution ? compilerOptions.baseUrl : undefined;
	if (!baseUrl && !paths) {
		return null;
	}

	const implicitBaseUrl = (
		implicitBaseUrlSymbol in compilerOptions
		&& (compilerOptions[implicitBaseUrlSymbol] as string)
	);

	const resolvedBaseUrl = path.resolve(
		path.dirname(tsconfig.path),
		baseUrl || implicitBaseUrl || '.'
	);

	const pathEntries = (
		paths
			? parsePaths(paths, baseUrl, resolvedBaseUrl, semantics)
			: []
	);

	const exactPathEntries = new Map<string, string[]>();
	const patternPathEntries: PathEntry<StarPattern>[] = [];

	for (const pathEntry of pathEntries) {
		if (typeof pathEntry.pattern === 'string') {
			exactPathEntries.set(
				pathEntry.pattern,
				semantics.exactMatchStripsWildcard ? pathEntry.substitutions.map(substitution => substitution.replace('*', '')) : pathEntry.substitutions
			);
		} else {
			patternPathEntries.push({
				pattern: pathEntry.pattern,
				substitutions: pathEntry.substitutions
			});
		}
	}

	return (specifier: string) => {
		if (isRelativePathPattern.test(specifier)) {
			return [];
		}

		const exactMatch = exactPathEntries.get(specifier);
		if (exactMatch) {
			return exactMatch.map(toPosixPath);
		}

		let matchedValue: PathEntry<StarPattern> | undefined;
		let longestMatchPrefixLength = -1;

		for (const pathEntry of patternPathEntries) {
			if (
				isPatternMatch(pathEntry.pattern, specifier)
				&& pathEntry.pattern.prefix.length > longestMatchPrefixLength
			) {
				longestMatchPrefixLength = pathEntry.pattern.prefix.length;
				matchedValue = pathEntry;
			}
		}

		if (!matchedValue) {
			/**
			 * TypeScript 6 falls back to baseUrl when no paths pattern matches (TypeScript 7 ignores baseUrl).
			 * These are separate resolution steps, not a fallback chain within paths.
			 *
			 * Reference: https://github.com/microsoft/TypeScript/blob/main/src/compiler/moduleNameResolver.ts#L1550-L1556
			 */
			return (
				baseUrl
					? [toPosixPath(path.join(resolvedBaseUrl, specifier))]
					: []
			);
		}

		const matchedPath = specifier.slice(
			matchedValue.pattern.prefix.length,
			specifier.length - matchedValue.pattern.suffix.length
		);

		return matchedValue.substitutions.map(
			substitution => toPosixPath(substitution.replace('*', matchedPath))
		);
	};
};
