import { build } from 'esbuild';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { existsSync } from 'node:fs';
import { rm, readFile } from 'node:fs/promises';

const projectRoot = cwd();
const packageJsonPath = join(projectRoot, 'package.json');
const packageJson: Record<string, unknown> = JSON.parse(await readFile(packageJsonPath, 'utf8'));
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

const collectTargetsFromExportValue = (exportValue: string | string[] | object) => {
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

	if (exportValue && typeof exportValue === 'object') {
		for (const nestedValue of Object.values(exportValue)) {
			collectTargetsFromExportValue(nestedValue);
		}
	}
};

for (const binTarget of Object.values(packageJson.bin ?? {})) {
	addEntryPointFromDistTarget(binTarget);
}

for (const exportValue of Object.values(packageJson.exports ?? {})) {
	collectTargetsFromExportValue(exportValue);
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
	target: 'node20',
	bundle: true,
	splitting: true,
	// Only runtime dependencies stay external; everything else (including
	// devDependencies imported by runtime code) must be bundled
	external: ['esbuild', '@d1g1tal/watchr'],
	minify: true,
	logLevel: 'info',
});
