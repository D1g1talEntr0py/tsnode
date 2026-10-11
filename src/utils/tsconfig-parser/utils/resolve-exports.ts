// Ported from https://github.com/privatenumber/resolve-pkg-maps (v1.0.0, commit 6d78804)
// MIT License, Copyright (c) Hiroki Osame <hiroki.osame@gmail.com>

type PathConditionsMap = {
	[condition: string]: PathConditions | null;
};

type PathOrMap = string | PathConditionsMap;

export type PathConditions = PathOrMap | readonly PathOrMap[];

const ERR_INVALID_PACKAGE_CONFIG = 'ERR_INVALID_PACKAGE_CONFIG';
const ERR_INVALID_PACKAGE_TARGET = 'ERR_INVALID_PACKAGE_TARGET';
const ERR_PACKAGE_PATH_NOT_EXPORTED = 'ERR_PACKAGE_PATH_NOT_EXPORTED';

const STAR = '*';
const isInteger = /^\d+$/;
const disallowedPathSegments = /^(?:\.{1,2}|node_modules)$/i;
const pathSeparator = /\/|\\/;
const hasProtocolPattern = /^\w+:/;

const createError = (code: string, message: string): Error & { code: string } => Object.assign(new Error(`[${code}]: ${message}`), { code });

const isConditionalObject = (exportsMap: PathConditionsMap) => {
	let isFirstKeyConditional: boolean | undefined;

	for (const key of Object.keys(exportsMap)) {
		const isKeyConditionalSugar = key === '' || key[0] !== '.';

		if (isFirstKeyConditional === undefined) {
			isFirstKeyConditional = isKeyConditionalSugar;
		} else if (isFirstKeyConditional !== isKeyConditionalSugar) {
			throw createError(ERR_INVALID_PACKAGE_CONFIG, '"exports" cannot contain some keys starting with "." and some not');
		}
	}

	return isFirstKeyConditional;
};

const hasHigherSpecificity = (keyA: string, keyB: string) => {
	const starIndexA = keyA.indexOf(STAR);
	const starIndexB = keyB.indexOf(STAR);

	return starIndexA === starIndexB ? keyB.length > keyA.length : starIndexB > starIndexA;
};

const findMatchingPath = (pathConditions: PathConditionsMap, request: string): [ string | undefined, string | undefined ] => {
	if (!request.includes(STAR) && Object.hasOwn(pathConditions, request)) { return [ request, undefined ] }

	let pathMatch: string | undefined;
	let starMatch: string | undefined;
	for (const exportPath of Object.keys(pathConditions)) {
		if (!exportPath.includes(STAR)) { continue }

		const [ prefix = '', suffix = '', remaining ] = exportPath.split(STAR);

		if (remaining === undefined && request.startsWith(prefix) && request.endsWith(suffix)) {
			const currentStarMatch = request.slice(prefix.length, -suffix.length || undefined);

			if (currentStarMatch && (!pathMatch || hasHigherSpecificity(pathMatch, exportPath))) {
				pathMatch = exportPath;
				starMatch = currentStarMatch;
			}
		}
	}

	return [ pathMatch, starMatch ];
};

// `undefined` is passed when there is no path match; `null` is a valid (blocking) exports target
const resolveConditions = (pathConditions: PathConditions | null | undefined, conditions: readonly string[], asterisk?: string): string[] => {
	if (pathConditions === null || pathConditions === undefined) { return [] }

	if (typeof pathConditions === 'string') {
		const [ firstSegment, ...pathSegments ] = pathConditions.split(pathSeparator);

		if (firstSegment === '..' || pathSegments.some((segment) => disallowedPathSegments.test(segment))) {
			throw createError(ERR_INVALID_PACKAGE_TARGET, `Invalid "exports" target "${pathConditions}" defined in the package config`);
		}

		return [ asterisk ? pathConditions.replaceAll(STAR, asterisk) : pathConditions ];
	}

	if (Array.isArray(pathConditions)) {
		return (pathConditions as readonly PathOrMap[]).flatMap((pathCondition) => resolveConditions(pathCondition, conditions, asterisk));
	}

	if (typeof pathConditions === 'object') {
		// Array.isArray does not narrow readonly arrays out of the union
		const conditionsMap = pathConditions as PathConditionsMap;
		for (const condition of Object.keys(conditionsMap)) {
			if (isInteger.test(condition)) {
				throw createError(ERR_INVALID_PACKAGE_CONFIG, 'Cannot contain numeric property keys');
			}

			if (condition === 'default' || conditions.includes(condition)) {
				return resolveConditions(conditionsMap[condition], conditions, asterisk);
			}
		}

		return [];
	}

	throw createError(ERR_INVALID_PACKAGE_TARGET, `Invalid "exports" target "${String(pathConditions)}"`);
};

// Based on https://github.com/nodejs/node/blob/v18.8.0/lib/internal/modules/esm/resolve.js#L549
export const resolveExports = (exports: PathConditions, request: string, conditions: readonly string[]): string[] => {
	if (!exports) { throw new Error('"exports" is required') }

	request = request === '' ? '.' : `./${request}`;

	if (typeof exports === 'string' || Array.isArray(exports) || (typeof exports === 'object' && isConditionalObject(exports as PathConditionsMap))) {
		exports = { '.': exports };
	}

	const exportsMap = exports as PathConditionsMap;
	const [ pathMatch, starMatch ] = findMatchingPath(exportsMap, request);

	const resolved = resolveConditions(pathMatch === undefined ? undefined : exportsMap[pathMatch], conditions, starMatch);

	if (resolved.length === 0) {
		throw createError(ERR_PACKAGE_PATH_NOT_EXPORTED, request === '.' ? 'No "exports" main defined' : `Package subpath '${request}' is not defined by "exports"`);
	}

	for (const resolvedPath of resolved) {
		if (!resolvedPath.startsWith('./') && !hasProtocolPattern.test(resolvedPath)) {
			throw createError(ERR_INVALID_PACKAGE_TARGET, `Invalid "exports" target "${resolvedPath}" defined in the package config`);
		}
	}

	return resolved;
};
