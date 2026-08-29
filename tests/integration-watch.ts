import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { createFixture } from 'fs-fixture';

const projectRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const cliPath = path.join(projectRoot, 'src/cli.ts');
const sourceResolveHookPath = path.join(projectRoot, 'tests/utils/source-resolve-hook.ts');
const tsconfigForFixture = {
	'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext' } }),
};

type SpawnResult = {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

const runWatch = (args: string[], cwd: string) => {
	const nodeOptions = [process.env.NODE_OPTIONS, '--experimental-strip-types', '--import', sourceResolveHookPath].filter(Boolean).join(' ');
	const childProcess = spawn(process.execPath, [cliPath, 'watch', ...args], {
		cwd,
		env: { ...process.env, NODE_OPTIONS: nodeOptions, TSNODE_DISABLE_IN_PROCESS: '1' },
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	let stdout = '';
	let stderr = '';
	childProcess.stdout!.setEncoding('utf8');
	childProcess.stderr!.setEncoding('utf8');
	const outputWaiters: Array<{ marker: string; occurrence: number; resolve: () => void }> = [];
	childProcess.stdout!.on('data', (chunk: string) => {
		stdout += chunk;
		for (const waiter of outputWaiters.splice(0)) {
			if (stdout.split(waiter.marker).length - 1 >= waiter.occurrence) {
				waiter.resolve();
			} else {
				outputWaiters.push(waiter);
			}
		}
	});
	childProcess.stderr!.on('data', (chunk: string) => { stderr += chunk; });

	const exited = new Promise<SpawnResult>((resolve) => {
		childProcess.on('close', (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
	});
	const waitForOutput = (marker: string, occurrence = 1) => {
		if (stdout.split(marker).length - 1 >= occurrence) { return Promise.resolve(); }

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error(`Timed out waiting for "${marker}"; stdout=${stdout}; stderr=${stderr}`)), 30_000);
			outputWaiters.push({
				marker,
				occurrence,
				resolve: () => {
					clearTimeout(timeout);
					resolve();
				},
			});
		});
	};

	const stop = async () => {
		if (childProcess.exitCode === null && !childProcess.killed) { childProcess.kill('SIGINT'); }
		await exited;
	};

	return { childProcess, exited, waitForOutput, stop, read: () => ({ stdout, stderr }) };
};

describe('watch integration', () => {
	test('reports missing script paths and supports help', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const missing = runWatch([], fixture.path);
		const missingResult = await missing.exited;
		expect(missingResult.exitCode).toBe(1);
		expect(missingResult.stderr).toContain('Missing required parameter "script path"');

		const help = runWatch(['--help'], fixture.path);
		const helpResult = await help.exited;
		expect(helpResult.exitCode).toBe(0);
		expect(helpResult.stdout).toContain('Usage: tsnode watch [options]');
	});

	test('reruns after a watched file changes', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'import { value } from "./value.ts"; console.log(`watch:${value}`); setInterval(() => {}, 1000);\n',
			'value.ts': 'export const value: number = 1;\n',
		});
		const watch = runWatch(['main.ts'], fixture.path);

		try {
			await watch.waitForOutput('watch:1');
			await writeFile(path.join(fixture.path, 'value.ts'), 'export const value: number = 2;\n');
			await watch.waitForOutput('watch:2');
		} finally {
			await watch.stop();
		}
	});

	test('reruns when stdin receives a newline', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log("stdin-run"); setInterval(() => {}, 1000);\n',
		});
		const watch = runWatch(['main.ts'], fixture.path);

		try {
			await watch.waitForOutput('stdin-run');
			watch.childProcess.stdin!.write('\n');
			await watch.waitForOutput('stdin-run', 2);
		} finally {
			await watch.stop();
		}
	});

	test('relays SIGINT to the running script and exits cleanly', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log("signal-ready"); setInterval(() => {}, 1000);\n',
		});
		const watch = runWatch(['main.ts'], fixture.path);

		try {
			await watch.waitForOutput('signal-ready');
			watch.childProcess.kill('SIGINT');
			const result = await watch.exited;
			expect(result.exitCode).toBe(0);
		} finally {
			await watch.stop();
		}
	});
});