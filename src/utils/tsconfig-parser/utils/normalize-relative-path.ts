import { toPosixPath } from './to-posix-path';
import { isRelativePathPattern } from './is-relative-path-pattern';

export const normalizeRelativePath = (filePath: string) => {
	const normalizedPath = toPosixPath(filePath);

	return isRelativePathPattern.test(normalizedPath) ? normalizedPath : `./${normalizedPath}`;
};
