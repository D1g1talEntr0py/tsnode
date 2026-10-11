import fs, { type Stats } from 'node:fs';
import type { Cache } from '../types';

const cached = <Result>(cache: Cache | undefined, cacheKey: string, compute: () => Result): Result => {
	if (cache?.has(cacheKey)) { return cache.get(cacheKey) as Result }

	const result = compute();
	cache?.set(cacheKey, result);

	return result;
};

export const stat = (cache: Cache | undefined, path: string): Stats | undefined => cached(cache, `statSync:${path}`, () => {
	// Match `existsSync`, which never throws (e.g. EACCES, invalid path)
	try { return fs.statSync(path, { throwIfNoEntry: false }) } catch { return undefined }
});

export const exists = (cache: Cache | undefined, path: string) => stat(cache, path) !== undefined;

export const readFile = (cache: Cache | undefined, path: string, encoding: BufferEncoding) => cached(cache, `readFileSync:${path}:${encoding}`, () => fs.readFileSync(path, encoding));

export const realpath = (cache: Cache | undefined, path: string): string => {
	const resolvedPath: unknown = cached(cache, `realpathSync:${path}`, () => fs.realpathSync(path));

	if (typeof resolvedPath !== 'string') {
		throw new TypeError(`Unexpected resolved path type for ${String(resolvedPath)} in ${path}`);
	}

	return resolvedPath;
};
