import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
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

const collect = (childProcess: ChildProcess) => {
	let stdout = '';
	let stderr = '';

	childProcess.stdout!.setEncoding('utf8');
	childProcess.stderr!.setEncoding('utf8');
	childProcess.stdout!.on('data', (chunk: string) => { stdout += chunk; });
	childProcess.stderr!.on('data', (chunk: string) => { stderr += chunk; });

	return {
		read: () => ({ stdout, stderr }),
		exited: new Promise<SpawnResult>((resolve) => {
			childProcess.on('close', (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
		}),
	};
};

const runCli = (
	args: string[],
	cwd: string,
	env?: Record<string, string>,
) => {
	const nodeOptions = [process.env.NODE_OPTIONS, '--experimental-strip-types', '--import', sourceResolveHookPath].filter(Boolean).join(' ');
	const childProcess = spawn(process.execPath, [cliPath, ...args], {
		cwd,
		env: { ...process.env, NODE_OPTIONS: nodeOptions, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	return { childProcess, ...collect(childProcess) };
};

/** Resolves once `marker` shows up on stdout, so tests never race on startup. */
const waitForStdout = (
	read: () => { stdout: string },
	marker: string,
) => new Promise<void>((resolve, reject) => {
	const deadline = Date.now() + 30_000;
	const poll = () => {
		if (read().stdout.includes(marker)) {
			resolve();
			return;
		}
		if (Date.now() > deadline) {
			reject(new Error(`Timed out waiting for "${marker}"`));
			return;
		}
		setTimeout(poll, 20);
	};
	poll();
});

describe('cli integration', () => {
	test('runs a TypeScript entry and exits cleanly', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'const message: string = "hello"; console.log(message);\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(result.stdout.trim()).toBe('hello');
		expect(result.exitCode).toBe(0);
	});

	test('reports its own version alongside the node version', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli(['--version'], fixture.path);
		const result = await exited;

		expect(result.exitCode).toBe(0);
		// Regression: JSON modules only expose a default export, so destructuring
		// `version` off the namespace printed "tsnode vundefined".
		expect(result.stdout).toMatch(/^tsnode v\d+\.\d+\.\d+/);
		expect(result.stdout).toContain('node v');
	});

	test('propagates a non-zero exit code from the entry', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'const code: number = 3; process.exit(code);\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path);

		expect((await exited).exitCode).toBe(3);
	});

	test('forwards arguments to the entry without leaking tsnode flags', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log(JSON.stringify(process.argv.slice(2)));\n',
		});

		const { exited } = runCli(['main.ts', '--flag', 'value'], fixture.path);
		const result = await exited;

		expect(JSON.parse(result.stdout.trim())).toEqual(['--flag', 'value']);
	});

	test('executes TypeScript eval input', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli(['-e', 'const value: number = 41; console.log(value + 1)'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(result.stdout.trim()).toBe('42');
		expect(result.exitCode).toBe(0);
	});

	test('supports top-level await and argv forwarding in eval mode', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli(['-e', 'await Promise.resolve(console.log(JSON.stringify(process.argv.slice(1))))', 'one', 'two'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(JSON.parse(result.stdout.trim())).toEqual(['one', 'two']);
		expect(result.exitCode).toBe(0);
	});

	test('runs eval input in-process', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli(['-e', 'console.log(process.ppid)'], fixture.path);
		const result = await exited;

		expect(Number(result.stdout.trim())).toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('resolves relative TypeScript imports from eval mode', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'value.ts': 'const value: number = 42; export default value;\n',
		});

		const { exited } = runCli(['-e', 'const { default: value } = await import("./value.ts"); console.log(value)'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(result.stdout.trim()).toBe('42');
		expect(result.exitCode).toBe(0);
	});

	test('prints transformed TypeScript expressions', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli(['-p', '(1 as number) + 2'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(result.stdout.trim()).toBe('3');
		expect(result.exitCode).toBe(0);
	});

	test('relays SIGINT to the child and reports exit code 130', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'const label: string = "ready"; console.log(label); setInterval(() => {}, 1000);\n',
		});

		const { childProcess, read, exited } = runCli(['main.ts'], fixture.path, {
			TSNODE_DISABLE_IN_PROCESS: '1',
			TSNODE_FORCE_SIGNAL_RELAY: '1',
			TSNODE_DISABLE_SIGNAL_RELAY: '0',
		});

		await waitForStdout(read, 'ready');

		// Signals only the parent, mimicking `kill -INT <pid>`. The child learns
		// about it via the IPC relay, not the process group.
		childProcess.kill('SIGINT');

		// 128 + SIGINT(2)
		expect((await exited).exitCode).toBe(130);
	});

	test('gives the child the env it needs to connect for signal relay', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log(JSON.stringify({ ipc: process.env.TSNODE_IPC ?? null, deps: process.env.TSNODE_DEPENDENCY_REPORTING ?? null }));\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path, {
			TSNODE_DISABLE_IN_PROCESS: '1',
			TSNODE_FORCE_SIGNAL_RELAY: '1',
			TSNODE_DISABLE_SIGNAL_RELAY: '0',
		});

		// The regression: without TSNODE_IPC the child never opened the socket,
		// so preflight bound no handlers and the relay was inert.
		// Dependency reporting must stay off — that is watch mode only.
		expect(JSON.parse((await exited).stdout.trim())).toEqual({ ipc: '1', deps: null });
	});

	test('leaves relay env unset when the relay is disabled', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log(JSON.stringify({ ipc: process.env.TSNODE_IPC ?? null }));\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path, {
			TSNODE_DISABLE_IN_PROCESS: '1',
			TSNODE_DISABLE_SIGNAL_RELAY: '1',
		});

		expect(JSON.parse((await exited).stdout.trim())).toEqual({ ipc: null });
	});

	/**
	 * The entry reports its parent pid. Run in-process, that is this test
	 * process; forked, it is the intermediate CLI process.
	 */
	const parentPidFixture = {
		'package.json': JSON.stringify({ type: 'module' }),
		...tsconfigForFixture,
		'main.ts': 'const ppid: number = process.ppid; console.log(ppid);\n',
	};

	test('runs the entry in-process instead of forking a child', async () => {
		await using fixture = await createFixture(parentPidFixture);

		const { exited } = runCli(['main.ts'], fixture.path);
		const result = await exited;

		// No intermediate process: the entry's parent is this test process.
		expect(Number(result.stdout.trim())).toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('runs a file URL entry in-process', async () => {
		await using fixture = await createFixture(parentPidFixture);
		const entryUrl = pathToFileURL(path.join(fixture.path, 'main.ts')).href;

		const { exited } = runCli([entryUrl], fixture.path);
		const result = await exited;

		expect(Number(result.stdout.trim())).toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('runs an extensionless entry in-process and preserves argv[1]', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log(JSON.stringify({ ppid: process.ppid, argv1: process.argv[1] }));\n',
		});

		const entry = path.join(fixture.path, 'main');
		const { exited } = runCli([entry], fixture.path);
		const result = await exited;
		const parsed = JSON.parse(result.stdout.trim()) as { ppid: number; argv1: string };

		expect(parsed.ppid).toBe(process.pid);
		expect(parsed.argv1).toBe(entry);
		expect(result.exitCode).toBe(0);
	});

	test('runs a directory entry in-process and preserves argv[1]', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'app/index.ts': 'console.log(JSON.stringify({ ppid: process.ppid, argv1: process.argv[1] }));\n',
		});

		const entry = path.join(fixture.path, 'app');
		const { exited } = runCli([entry], fixture.path);
		const result = await exited;
		const parsed = JSON.parse(result.stdout.trim()) as { ppid: number; argv1: string };

		expect(parsed.ppid).toBe(process.pid);
		expect(parsed.argv1).toBe(entry);
		expect(result.exitCode).toBe(0);
	});

	test('falls back to forking when opted out', async () => {
		await using fixture = await createFixture(parentPidFixture);

		const { exited } = runCli(['main.ts'], fixture.path, { TSNODE_DISABLE_IN_PROCESS: '1' });
		const result = await exited;

		expect(Number(result.stdout.trim())).not.toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('normalizes a file URL entry before forking', async () => {
		await using fixture = await createFixture(parentPidFixture);
		const entryUrl = pathToFileURL(path.join(fixture.path, 'main.ts')).href;

		const { exited } = runCli([entryUrl], fixture.path, { TSNODE_DISABLE_IN_PROCESS: '1' });
		const result = await exited;

		expect(Number(result.stdout.trim())).not.toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('forks when node flags are present', async () => {
		await using fixture = await createFixture(parentPidFixture);

		// --enable-source-maps only applies to a freshly bootstrapped process
		const { exited } = runCli(['--enable-source-maps', 'main.ts'], fixture.path);
		const result = await exited;

		expect(Number(result.stdout.trim())).not.toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('reports a failing entry with a non-zero exit code in-process', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'const reason: string = "boom"; throw new Error(reason);\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path);
		const result = await exited;

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain('boom');
	});
});
