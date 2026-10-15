import path from 'node:path';
import { rename, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { childEnvironment, createFixture } from './utils/fixture';
import { Json } from '../src/utils/json';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'src/cli.ts');
const sourceResolveHookPath = path.join(projectRoot, 'tests/utils/source-resolve-hook.ts');
const tsconfigForFixture = {
	'tsconfig.json': Json.serialize({ compilerOptions: { target: 'esnext', module: 'esnext' } })!,
};

type SpawnResult = {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

const runWatch = (args: string[], cwd: string, env: Record<string, string> = {}) => {
	const nodeOptions = [process.env['NODE_OPTIONS'], '--experimental-strip-types', '--import', sourceResolveHookPath].filter(Boolean).join(' ');
	const childProcess = spawn(process.execPath, [cliPath, 'watch', ...args], {
		cwd,
		env: childEnvironment({ NODE_OPTIONS: nodeOptions, TSNODE_DISABLE_IN_PROCESS: '1', ...env }),
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	let stdout = '';
	let stderr = '';
	childProcess.stdout!.setEncoding('utf-8');
	childProcess.stderr!.setEncoding('utf-8');
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
	test('missing includes fail before starting the child and leave no live watcher', async () => {
		await using fixture = await createFixture({
			'package.json': Json.serialize({ type: 'module' })!,
			'main.ts': 'console.log("unexpected-child"); setInterval(() => {}, 1000);\n',
		});
		const watch = runWatch(['--include', 'missing.ts', 'main.ts'], fixture.path);
		try {
			const result = await watch.exited;
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain('Watch failed:');
			expect(result.stderr).toContain('Path not found');
			expect(result.stdout).not.toContain('unexpected-child');
		} finally {
			await watch.stop();
		}
	});

	test.skipIf(process.platform === 'win32')('restarts and shuts down after a child exits by signal', async () => {
		await using fixture = await createFixture({
			'package.json': Json.serialize({ type: 'module' })!,
			...tsconfigForFixture,
			'main.ts': 'process.stdout.write(`self-exit:${process.pid}\\n`, () => process.kill(process.pid, "SIGTERM"));\n',
		});
		const watch = runWatch(['main.ts'], fixture.path, { TSNODE_SIGNAL_RELAY: '0' });
		const waitForChildExit = async () => {
			const matches = [...watch.read().stdout.matchAll(/self-exit:(\d+)/g)];
			const pid = Number(matches.at(-1)![1]);
			await expect.poll(() => {
				try { process.kill(pid, 0); return false; } catch { return true; }
			}).toBe(true);
		};
		try {
			await watch.waitForOutput('self-exit:');
			await waitForChildExit();
			watch.childProcess.stdin!.write('\n');
			await watch.waitForOutput('self-exit:', 2);
			await waitForChildExit();
			watch.childProcess.kill('SIGINT');
			const result = await watch.exited;
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe('');
		} finally {
			await watch.stop();
		}
	});
	test('reports missing script paths and supports help', async () => {
		await using fixture = await createFixture({ 'package.json': Json.serialize({ type: 'module' })! });

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
			'package.json': Json.serialize({ type: 'module' })!,
			...tsconfigForFixture,
			'main.ts': 'import { value } from "./value.ts"; console.log(`watch:${value}`); setInterval(() => {}, 1000);\n',
			'value.ts': 'export const value: number = 1;\n',
		});
		const watch = runWatch(['main.ts'], fixture.path, { TSNODE_DEBUG: '1' });

		try {
			await watch.waitForOutput('watch:1');
			await watch.waitForOutput(`Watching dependency ${path.join(fixture.path, 'value.ts')}`);
			await writeFile(path.join(fixture.path, 'value.ts'), 'export const value: number = 2;\n');
			await watch.waitForOutput('watch:2');
		} finally {
			await watch.stop();
		}
	});

	test('keeps exact dependency coverage across atomic saves without watching siblings', async () => {
		await using fixture = await createFixture({
			'package.json': Json.serialize({ type: 'module' })!,
			...tsconfigForFixture,
			'main.ts': 'import { value } from "./value.ts"; console.log(`atomic:${value}`); setInterval(() => {}, 1000);\n',
			'value.ts': 'export const value: number = 1;\n',
			'unrelated.ts': 'export const value = 0;\n',
		});
		const watch = runWatch(['main.ts'], fixture.path, { TSNODE_DEBUG: '1' });
		try {
			await watch.waitForOutput('atomic:1');
			const dependencyReady = `Watching dependency ${path.join(fixture.path, 'value.ts')}`;
			await watch.waitForOutput(dependencyReady);
			await writeFile(path.join(fixture.path, 'value.ts'), 'export const value: number = 2;\n');
			await watch.waitForOutput('atomic:2');
			await watch.waitForOutput(dependencyReady, 2);
			await writeFile(path.join(fixture.path, 'replacement.ts'), 'export const value: number = 3;\n');
			await rename(path.join(fixture.path, 'replacement.ts'), path.join(fixture.path, 'value.ts'));
			await watch.waitForOutput('atomic:3');
			await watch.waitForOutput(dependencyReady, 3);
			await writeFile(path.join(fixture.path, 'replacement.ts'), 'export const value: number = 4;\n');
			await rename(path.join(fixture.path, 'replacement.ts'), path.join(fixture.path, 'value.ts'));
			await watch.waitForOutput('atomic:4');
			await watch.waitForOutput(dependencyReady, 4);
			const runsBefore = watch.read().stdout.split('atomic:').length - 1;
			await writeFile(path.join(fixture.path, 'unrelated.ts'), 'export const value = 1;\n');
			await delay(200);
			expect(watch.read().stdout.split('atomic:').length - 1).toBe(runsBefore);
			expect(watch.read().stderr).toBe('');
		} finally {
			await watch.stop();
		}
	});

	test('prunes stale dependencies but retains explicit includes that overlap the import graph', async () => {
		await using fixture = await createFixture({
			'package.json': Json.serialize({ type: 'module' })!,
			...tsconfigForFixture,
			'main.ts': 'import { readFile } from "node:fs/promises"; const name = (await readFile("mode.txt", "utf8")).trim(); const { value } = await import(`./${name}.ts`); await import("./included/value.ts"); console.log(`active:${value}`); setInterval(() => {}, 1000);\n',
			'mode.txt': 'old',
			'old.ts': 'export const value = "old";\n',
			'new.ts': 'export const value = "new";\n',
			'included/value.ts': 'export const included = 1;\n',
		});
		const watch = runWatch(['--include', 'mode.txt', '--include', 'included', 'main.ts'], fixture.path, { TSNODE_DEBUG: '1' });
		try {
			await watch.waitForOutput('active:old');
			await watch.waitForOutput(`Watching dependency ${path.join(fixture.path, 'old.ts')}`);
			await writeFile(path.join(fixture.path, 'mode.txt'), 'new');
			await watch.waitForOutput('active:new');
			await watch.waitForOutput(`Watching dependency ${path.join(fixture.path, 'new.ts')}`);
			watch.childProcess.stdin!.write('\n');
			await watch.waitForOutput('active:new', 2);
			await watch.waitForOutput(`Watching dependency ${path.join(fixture.path, 'new.ts')}`, 2);
			const runsBefore = watch.read().stdout.split('active:').length - 1;
			await writeFile(path.join(fixture.path, 'old.ts'), 'export const value = "stale";\n');
			await delay(200);
			expect(watch.read().stdout.split('active:').length - 1).toBe(runsBefore);
			await writeFile(path.join(fixture.path, 'included/extra.ts'), 'export const extra = 1;\n');
			await watch.waitForOutput('active:new', 3);
			await writeFile(path.join(fixture.path, 'new.ts'), 'export const value = "updated";\n');
			await watch.waitForOutput('active:updated');
			expect(watch.read().stderr).toBe('');
		} finally {
			await watch.stop();
		}
	});

	test('reruns when stdin receives a newline', async () => {
		await using fixture = await createFixture({
			'package.json': Json.serialize({ type: 'module' })!,
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

	test.skipIf(process.platform === 'win32')('relays SIGINT to the running script and exits cleanly', async () => {
		await using fixture = await createFixture({
			'package.json': Json.serialize({ type: 'module' })!,
			...tsconfigForFixture,
			'main.ts': 'console.log("signal-ready"); setInterval(() => {}, 1000);\n',
		});
		const watch = runWatch(['main.ts'], fixture.path);

		try {
			await watch.waitForOutput('signal-ready');
			watch.childProcess.kill('SIGINT');
			const result = await watch.exited;
			expect(result.exitCode).toBe(130);
		} finally {
			await watch.stop();
		}
	});
});