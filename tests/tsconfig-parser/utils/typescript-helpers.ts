import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { TypeScriptConfig, TypeScriptVersion } from '../../../src/utils/tsconfig-parser';
import { Json } from '../../../src/utils/json';

export const typescriptVersions = [6, 7] as const satisfies readonly TypeScriptVersion[];

const execFileAsync = promisify(execFile);

export const runNode = (args: string[], cwd: string) => execFileAsync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

const tscPaths: Record<TypeScriptVersion, string> = {
	6: fileURLToPath(new URL('./tsc.js', import.meta.resolve('typescript'))),
	7: path.join(path.dirname(fileURLToPath(import.meta.resolve('@typescript/native/package.json'))), 'bin/tsc')
};

export const getTscTsconfig = async (cwd: string, tsconfigPath?: string, version: TypeScriptVersion = 6): Promise<TypeScriptConfig> => {
	const tscArgs = ['--showConfig'];

	if (tsconfigPath) {
		tscArgs.push('--project', tsconfigPath);
	}

	const tscProcess = await runNode(
		[tscPaths[version], ...tscArgs],
		cwd
	);

	return Json.parse(tscProcess.stdout) as TypeScriptConfig;
};

const resolveAttemptPattern = /^(File|Directory) '(.+)'/gm;

const divider = '='.repeat(8);

const parseTscResolve = async (
	stdout: string,
	request: string
) => {
	const resolveLog = stdout.slice(
		stdout.indexOf(`${divider} Resolving module '${request}'`),
		stdout.indexOf(`${divider} Module name '${request}'`)
	);
	const resolveAttempts = resolveLog.matchAll(resolveAttemptPattern);

	return Array.from(resolveAttempts).map((
		[, type, filePath]
	) => ({
		type: type!,
		filePath: filePath!
	}));
};

export const getTscResolution = async (
	request: string,
	fixturePath: string,
	version: TypeScriptVersion = 6
) => {
	const filePath = path.join(fixturePath, `${randomUUID()}.ts`);

	await fs.writeFile(filePath, `import '${request}'`);

	try {
		const { stdout } = await runNode(
			[
				tscPaths[version],
				'--traceResolution',
				'--noEmit',
				'--ignoreDeprecations',
				'6.0',
				'--noUncheckedSideEffectImports',
				'false'
			],
			fixturePath
		);

		return await parseTscResolve(stdout, request);
	} finally {
		await fs.rm(filePath, {
			force: true
		});
	}
};
