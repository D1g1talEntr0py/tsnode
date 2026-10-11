import { exists } from './fs-cached';
import { posix, dirname } from 'node:path';
import type { Cache } from '../types';

export const findUp = (searchPath: string, fileName: string, cache?: Cache) => {
	while (true) {
		const configPath = posix.join(searchPath, fileName);

		if (exists(cache, configPath)) { return configPath }

		const parentPath = dirname(searchPath);

		if (parentPath === searchPath) { return }

		searchPath = parentPath;
	}
};
