import { build } from 'esbuild';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { existsSync } from 'node:fs';
import { rm, chmod, readFile, writeFile } from 'node:fs/promises';
import packageJson from '../../package.json' with { type: 'json' };

const projectRoot = cwd();
const entryPoints = new Set<string>();

const addEntryPointFromDistTarget = (target: string) => {
	if (typeof target !== 'string' || !target.startsWith('./dist/') || !target.endsWith('.js')) { return }

	const relativeWithoutExtension = target.slice('./dist/'.length, -'.js'.length);
	const sourceCandidates = [ join(projectRoot, 'src', `${relativeWithoutExtension}.ts`) ];

	for (const candidate of sourceCandidates) {
		if (existsSync(candidate)) {
			entryPoints.add(candidate);
			break;
		}
	}
};

const collectTargetsFromExportValue = (exportValue: unknown) => {
	if (typeof exportValue === 'string') {
		addEntryPointFromDistTarget(exportValue);
		return;
	}

	if (Array.isArray(exportValue)) {
		for (const nestedValue of exportValue) {
			collectTargetsFromExportValue(nestedValue);
		}
		return;
	}

	if (exportValue !== null && typeof exportValue === 'object') {
		for (const nestedValue of Object.values(exportValue)) {
			collectTargetsFromExportValue(nestedValue);
		}
	}
};

if (typeof packageJson.bin === 'string') {
	addEntryPointFromDistTarget(packageJson.bin);
} else if (typeof packageJson.bin === 'object') {
	for (const binTarget of Object.values(packageJson.bin)) {
		addEntryPointFromDistTarget(binTarget);
	}
}

if (typeof packageJson.exports === 'string') {
	addEntryPointFromDistTarget(packageJson.exports);
} else if (packageJson.exports !== null && typeof packageJson.exports === 'object') {
	for (const exportValue of Object.values(packageJson.exports)) {
		collectTargetsFromExportValue(exportValue);
	}
}

if (entryPoints.size === 0) {
	throw new Error('No source entry points could be resolved from package.json exports/bin targets.');
}

await rm(join(projectRoot, 'dist'), { recursive: true, force: true });

await build({
	entryPoints: Array.from(entryPoints),
	outdir: join(projectRoot, 'dist'),
	outbase: join(projectRoot, 'src'),
	platform: 'node',
	format: 'esm',
	target: 'node24',
	bundle: true,
	splitting: true,
	// Only runtime dependencies stay external; everything else (including devDependencies imported by runtime code) must be bundled
	external: [ 'esbuild', '@d1g1tal/watchr' ],
	minify: true,
	logLevel: 'info'
});

const cliOutputPath = join(projectRoot, 'dist', 'cli.js');
const cliOutput = await readFile(cliOutputPath, 'utf8');

if (!cliOutput.startsWith('#!/usr/bin/env node\n')) {
	await writeFile(cliOutputPath, `#!/usr/bin/env node\n${cliOutput}`, 'utf8');
}

await chmod(cliOutputPath, 0o755);
