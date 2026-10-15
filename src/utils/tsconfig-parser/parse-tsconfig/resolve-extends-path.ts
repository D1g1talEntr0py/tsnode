import path from 'node:path';
import { findUp } from '../utils/find-up';
import { resolveExports, type PathConditions } from '../utils/resolve-exports';
import { readJsonc } from '../utils/read-jsonc';
import { stat, exists, realpath } from '../utils/fs-cached';
import type { Cache } from '../types';

type PackageJson = { [field: string]: unknown; exports?: PathConditions; tsconfig?: string };

const resolveFromPackageJsonPath = (packageJsonPath: string, subpath: string, ignoreExports?: boolean, cache?: Cache) => {
	const cacheKey = `resolveFromPackageJsonPath:${packageJsonPath}:${subpath}:${ignoreExports}`;

	if (cache?.has(cacheKey)) {
		const cachedPath = cache.get(cacheKey);
		if (typeof cachedPath === 'string' || cachedPath === false || cachedPath === undefined) { return cachedPath }

		throw new TypeError(`Invalid cached extends path for ${packageJsonPath}`);
	}

	let packageJson: PackageJson;
	try { packageJson = readJsonc(packageJsonPath, cache) as PackageJson } catch { return }

	if (!packageJson) { return }

	let resolvedPath = subpath || 'tsconfig.json';

	if (!ignoreExports && packageJson.exports) {
		try { (resolvedPath = resolveExports(packageJson.exports, subpath, [ 'require', 'types', 'node' ])[0]!) } catch {
			cache?.set(cacheKey, false);

			return false;
		}
	} else if (!subpath && packageJson.tsconfig) {
		resolvedPath = packageJson.tsconfig;
	}

	resolvedPath = path.join(packageJsonPath, '..', resolvedPath);

	cache?.set(cacheKey, resolvedPath);

	return resolvedPath;
};

const PACKAGE_JSON = 'package.json';
const TS_CONFIG_JSON = 'tsconfig.json';

export const resolveExtendsPath = (requestedPath: string, directoryPath: string, cache?: Cache) => {
	let filePath = requestedPath;

	if (requestedPath === '..') { filePath = path.join(filePath, TS_CONFIG_JSON) }

	if (requestedPath[0] === '.') { filePath = path.resolve(directoryPath, filePath) }

	if (path.isAbsolute(filePath)) {
		const fileStats = stat(cache, filePath);
		if (fileStats) {
			if (fileStats.isFile()) { return filePath }
		} else if (!filePath.endsWith('.json')) {
			const jsonPath = `${filePath}.json`;

			if (exists(cache, jsonPath)) { return jsonPath }
		}

		return;
	}

	const [ orgOrName = '', ...remaining ] = requestedPath.split('/');
	const packageName = orgOrName[0] === '@' ? `${orgOrName}/${remaining.shift()}` : orgOrName;
	const subpath = remaining.join('/');

	const rawPackagePath = findUp(path.resolve(directoryPath), path.join('node_modules', packageName), cache);

	if (!rawPackagePath || !stat(cache, rawPackagePath)?.isDirectory()) { return }

	const packagePath = realpath(cache, rawPackagePath);

	const packageJsonPath = path.join(packagePath, PACKAGE_JSON);
	if (exists(cache, packageJsonPath)) {
		const resolvedPath = resolveFromPackageJsonPath(packageJsonPath, subpath, false, cache);

		// Blocked
		if (resolvedPath === false) { return }

		if (resolvedPath && stat(cache, resolvedPath)?.isFile()) { return resolvedPath }
	}

	const fullPackagePath = path.join(packagePath, subpath);
	const jsonExtension = fullPackagePath.endsWith('.json');

	if (!jsonExtension) {
		const fullPackagePathWithJson = `${fullPackagePath}.json`;

		if (exists(cache, fullPackagePathWithJson)) { return fullPackagePathWithJson }
	}

	const fullPackageStats = stat(cache, fullPackagePath);

	if (!fullPackageStats) { return }

	if (fullPackageStats.isDirectory()) {
		const fullPackageJsonPath = path.join(fullPackagePath, PACKAGE_JSON);
		if (exists(cache, fullPackageJsonPath)) {
			const resolvedPath = resolveFromPackageJsonPath(fullPackageJsonPath, '', true, cache);
			if (resolvedPath && exists(cache, resolvedPath)) { return resolvedPath }
		}

		const tsconfigPath = path.join(fullPackagePath, TS_CONFIG_JSON);

		if (exists(cache, tsconfigPath)) { return tsconfigPath }
	} else if (jsonExtension) {
		return fullPackagePath;
	}

	return undefined;
};
