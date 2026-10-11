import path from 'node:path';
import { parseTsconfig, type ParseTsconfigOptions, type TsConfigJson, type TsConfigResult } from '../../../src/utils/tsconfig-parser';
import { findUp } from '../../../src/utils/tsconfig-parser/utils/find-up';
import { toPosixPath } from '../../../src/utils/tsconfig-parser/utils/to-posix-path';

export const createTsconfigJson = (
	tsconfig: TsConfigJson
) => JSON.stringify(tsconfig);

export const createPackageJson = (
	packageJson: Record<string, unknown>
) => JSON.stringify(packageJson);

/**
 * Test stand-in for the removed `getTsconfig`: finds the nearest tsconfig.json and parses it.
 */
export const getTsconfig = (searchPath = process.cwd(), options: ParseTsconfigOptions = {}): TsConfigResult | null => {
	const cache = options.cache ?? new Map();
	const configPath = findUp(toPosixPath(path.resolve(searchPath)), 'tsconfig.json', cache);

	return configPath ? { path: configPath, config: parseTsconfig(configPath, { ...options, cache }) } : null;
};
