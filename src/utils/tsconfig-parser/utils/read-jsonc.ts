import { parse } from 'jsonc-parser';
import { readFile } from './fs-cached';
import { encoding } from 'src/utils/constants';
import type { ParseError } from 'jsonc-parser';
import type { Cache } from '../types';

export const readJsonc = (jsonPath: string, cache?: Cache) => {
	const source = readFile(cache, jsonPath, encoding);
	const errors: ParseError[] = [];
	const config: unknown = parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source, errors, { allowTrailingComma: true });

	if (errors.length > 0 || config === undefined || config === null || typeof config !== 'object' || Array.isArray(config)) {
		throw new SyntaxError(`Invalid JSONC at ${jsonPath}`);
	}

	return config as unknown;
};
