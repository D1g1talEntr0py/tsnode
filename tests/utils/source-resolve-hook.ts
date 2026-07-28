import module from 'node:module';
import { accessSync, constants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const canAccess = (filePath: string) => {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
};

module.registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
			if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ERR_UNSUPPORTED_DIR_IMPORT') {
				throw error;
			}

			const isRelativeOrAbsolute = specifier.startsWith('./')
				|| specifier.startsWith('../')
				|| specifier.startsWith('/')
				|| specifier.startsWith('file:');
			if (!isRelativeOrAbsolute) { throw error; }

			const parentURL = context.parentURL ?? pathToFileURL(`${process.cwd()}/`).href;
			const resolvedURL = new URL(specifier, parentURL);
			const resolvedPath = fileURLToPath(resolvedURL);

			const candidates: string[] = [];
			if (!path.extname(resolvedPath)) {
				candidates.push(`${resolvedPath}.ts`, path.join(resolvedPath, 'index.ts'));
			}
			if (resolvedPath.endsWith('.js')) {
				candidates.push(`${resolvedPath.slice(0, -3)}.ts`);
			}

			for (const candidate of candidates) {
				if (canAccess(candidate)) {
					return nextResolve(pathToFileURL(candidate).href, context);
				}
			}

			throw error;
		}
	},
});