import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';

export type ComparisonImplementation = {
	name: string;
	cliPath: string;
};

type PackageTarget = {
	packageName: string;
	binName: string;
	installSpecs?: string[];
	allowBuild?: string[];
};

const packageTargets: Record<string, PackageTarget> = {
	tsx: {
		packageName: 'tsx',
		binName: 'tsx',
	},
	'ts-node': {
		packageName: 'ts-node',
		binName: 'ts-node-esm',
		installSpecs: ['ts-node', 'typescript@npm:@typescript/typescript6@^6.0.2'],
	},
	jiti: {
		packageName: 'jiti',
		binName: 'jiti',
	},
	esrun: {
		packageName: 'esrun',
		binName: 'esrun',
		allowBuild: ['esbuild'],
	},
};

const comparisonSpecifierPattern = /^(tsx|ts-node|jiti|esrun)(?:@(.*))?$/;

// undefined when the path doesn't exist (ENOENT)
const statSafe = (
	checkPath: string,
) => fs.stat(checkPath).catch(() => undefined);

const readPackageBinPath = async (
	packageRoot: string,
	binName: string,
): Promise<string> => {
	const packageJsonPath = path.join(packageRoot, 'package.json');
	const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
		bin?: string | Record<string, string>;
	};

	if (typeof packageJson.bin === 'string') {
		return packageJson.bin;
	}

	if (packageJson.bin && binName in packageJson.bin) {
		return packageJson.bin[binName];
	}

	if (packageJson.bin) {
		const [firstBinPath] = Object.values(packageJson.bin);
		if (firstBinPath) {
			return firstBinPath;
		}
	}

	throw new Error(`Could not resolve ${binName} from ${packageJsonPath}`);
};

const resolveInstalledPackage = async (
	packageName: string,
	binName: string,
	installDirectory: string,
	label: string,
): Promise<ComparisonImplementation> => {
	const packageRoot = path.join(installDirectory, 'node_modules', packageName);
	const binPath = path.join(packageRoot, await readPackageBinPath(packageRoot, binName));

	if (!(await statSafe(binPath))) {
		throw new Error(`Installed ${label} without ${binName}`);
	}

	return {
		name: label,
		cliPath: binPath,
	};
};

const resolveComparisonTarget = (
	specifier: string,
): PackageTarget & { displayName: string; installSpecifier: string } => {
	const match = specifier.match(comparisonSpecifierPattern);
	if (match) {
		const target = packageTargets[match[1]];
		const version = match[2];
		return {
			...target,
			displayName: version ? `${match[1]}@${version}` : match[1],
			installSpecifier: version ? `${target.packageName}@${version}` : target.packageName,
		};
	}

	return {
		...packageTargets.tsx,
		displayName: `tsx@${specifier}`,
		installSpecifier: `tsx@${specifier}`,
	};
};

/**
 * Resolves a comparison target to a CLI entry point.
 * Accepts a path (to a CLI file or a package directory) or an npm specifier
 * (tsx version, ts-node/jiti/esrun package name, or package@version), which
 * gets installed into a subdirectory of installRootPath.
 */
export const resolveComparison = async (
	specifier: string,
	installRootPath: string,
): Promise<ComparisonImplementation> => {
	const stats = await statSafe(specifier);
	if (stats) {
		if (stats.isFile()) {
			return {
				name: specifier,
				cliPath: path.resolve(specifier),
			};
		}

		const cliJsPath = path.resolve(specifier, 'dist/cli.js');
		if (await statSafe(cliJsPath)) {
			return {
				name: specifier,
				cliPath: cliJsPath,
			};
		}

		const cliMjsPath = path.resolve(specifier, 'dist/cli.mjs');
		if (await statSafe(cliMjsPath)) {
			return {
				name: specifier,
				cliPath: cliMjsPath,
			};
		}

		throw new Error(`Could not find dist/cli.js or dist/cli.mjs in ${specifier}`);
	}

	const target = resolveComparisonTarget(specifier);
	const installDirectory = path.join(installRootPath, specifier.replaceAll(/[^\w.-]/g, '-'));
	await fs.mkdir(installDirectory, { recursive: true });
	await fs.writeFile(
		path.join(installDirectory, 'package.json'),
		JSON.stringify({
			name: 'comparison-benchmark',
			private: true,
		}),
	);

	process.stderr.write(`Installing ${target.installSpecifier}...\n`);
	await execa('pnpm', [
		'add',
		...(target.installSpecs ?? [target.installSpecifier]),
		...(target.allowBuild ? [`--allow-build=${target.allowBuild.join(',')}`] : []),
	], {
		cwd: installDirectory,
	});

	return resolveInstalledPackage(target.packageName, target.binName, installDirectory, target.displayName);
};
