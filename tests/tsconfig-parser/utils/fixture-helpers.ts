import path from 'node:path';
import { parseTsconfig, type ParseTsconfigOptions, type TypeScriptConfig, type TsConfigResult } from '../../../src/utils/tsconfig-parser';
import { findUp } from '../../../src/utils/tsconfig-parser/utils/find-up';
import { toPosixPath } from '../../../src/utils/tsconfig-parser/utils/to-posix-path';
import { Json } from '../../../src/utils/json';

export const createTsconfigJson = (
	tsconfig: TypeScriptConfig
) => {
	const serialized = Json.serialize(tsconfig);
	if (serialized === undefined) { throw new TypeError('Fixture tsconfig must serialize to JSON') }
	return serialized;
};

export const createPackageJson = (
	packageJson: Record<string, unknown>
) => {
	const serialized = Json.serialize(packageJson);
	if (serialized === undefined) { throw new TypeError('Fixture package must serialize to JSON') }
	return serialized;
};

/**
 * Test stand-in for the removed `getTsconfig`: finds the nearest tsconfig.json and parses it.
 */
export const getTsconfig = (searchPath = process.cwd(), options: ParseTsconfigOptions = {}): TsConfigResult | null => {
	const cache = options.cache ?? new Map();
	const configPath = findUp(toPosixPath(path.resolve(searchPath)), 'tsconfig.json', cache);

	return configPath ? { path: configPath, config: parseTsconfig(configPath, { ...options, cache }) } : null;
};
