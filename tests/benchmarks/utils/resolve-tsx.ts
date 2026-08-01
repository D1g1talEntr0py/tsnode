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

const resolveGlobalCliPath = async (binaryPath: string): Promise<string> => {
	const normalizeCandidate = (candidate: string) => {
		const cleaned = candidate.trim().replace(/^['\"]|['\"]$/g, '');
		return path.isAbsolute(cleaned) ? cleaned : path.resolve(path.dirname(binaryPath), cleaned);
	};

	const resolveModuleTarget = async (candidate: string | undefined) => {
		if (!candidate) {
			return undefined;
		}

		const resolved = normalizeCandidate(candidate);
		if (!/\.js$/i.test(resolved)) {
			return undefined;
		}

		const stats = await statSafe(resolved);
		if (!stats?.isFile()) {
			return undefined;
		}

		return resolved;
	};

	const binContent = await fs.readFile(binaryPath, 'utf8').catch(() => undefined);
	if (binContent) {
		const match = binContent.match(/# cmd-shim-target=(.+)/);
		const shimTarget = await resolveModuleTarget(match?.[1]);
		if (shimTarget) {
			return shimTarget;
		}

		const quotedModulePathMatch = binContent.match(/["']([^"']+\.js)["']/i);
		const quotedModuleTarget = await resolveModuleTarget(quotedModulePathMatch?.[1]);
		if (quotedModuleTarget) {
			return quotedModuleTarget;
		}
	}

	const realPathTarget = await resolveModuleTarget(await fs.realpath(binaryPath).catch(() => undefined));
	if (realPathTarget) {
		return realPathTarget;
	}

	throw new Error(`Could not resolve a JavaScript module target from global binary: ${binaryPath}`);
};

const findExecutableOnPath = async (binaryName: string): Promise<string | undefined> => {
	const pathValue = process.env['PATH'];
	if (!pathValue) { return undefined }

	const pathDirectories = pathValue.split(path.delimiter).filter(Boolean);
	const candidateExtensions = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.trim()).filter(Boolean) : [''];

	for (const directory of pathDirectories) {
		const basePath = path.join(directory, binaryName);

		for (const extension of candidateExtensions) {
			const candidatePath = process.platform === 'win32' && extension	? `${basePath}${extension.toLowerCase()}` : basePath;

			if ((await statSafe(candidatePath))?.isFile()) { return candidatePath }

			if (process.platform === 'win32' && extension) {
				const upperCaseCandidate = `${basePath}${extension.toUpperCase()}`;
				if ((await statSafe(upperCaseCandidate))?.isFile()) { return upperCaseCandidate }
			}
		}
	}

	return undefined;
};

export const resolveGlobalTsxPaths = async (): Promise<{ cli: string; esmLoader: string } | null> => {
	try {
		const tsxBin = await findExecutableOnPath('tsx');
		if (!tsxBin) { return null }

		const cliPath = await resolveGlobalCliPath(tsxBin);
		const pkgRoot = path.resolve(path.dirname(cliPath), '..');
		const esmLoaderCandidates = [ path.join(pkgRoot, 'dist/esm/index.js') ];

		const esmLoader = await (async () => {
			for (const candidate of esmLoaderCandidates) {
				try {
					await fs.access(candidate);
					return candidate;
				} catch {}
			}
			return undefined;
		})();

		if (!esmLoader) {
			return null;
		}

		return { cli: cliPath, esmLoader };
	} catch {
		return null;
	}
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

		throw new Error(`Could not find dist/cli.js in ${specifier}`);
	}

	if (specifier === 'tsx') {
		const tsx = await resolveGlobalTsxPaths();
		if (tsx) {
			return {
				name: 'tsx',
				cliPath: tsx.cli,
			};
		}
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
