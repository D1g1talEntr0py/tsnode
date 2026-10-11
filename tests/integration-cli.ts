import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { createFixture } from 'fs-fixture';
import { childEnvironment } from './utils/fixture';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'src/cli.ts');
const sourceResolveHookPath = path.join(projectRoot, 'tests/utils/source-resolve-hook.ts');
const executionEnvironments: Record<string, string>[] = [{}, { TSNODE_DISABLE_IN_PROCESS: '1' }];

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

	childProcess.stdout!.setEncoding('utf-8');
	childProcess.stderr!.setEncoding('utf-8');
	childProcess.stdout!.on('data', (chunk: string) => { stdout += chunk; });
	childProcess.stderr!.on('data', (chunk: string) => { stderr += chunk; });

	return {
		read: () => ({ stdout, stderr }),
		exited: new Promise<SpawnResult>((resolve) => {
			childProcess.on('close', (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
		}),
	};
};

const runCli = (args: string[], cwd: string, env?: Record<string, string>, execArgv: string[] = []) => {
	const nodeOptions = [process.env['NODE_OPTIONS'], '--experimental-strip-types', '--import', sourceResolveHookPath].filter(Boolean).join(' ');
	const childProcess = spawn(process.execPath, [...execArgv, cliPath, ...args], {
		cwd,
		env: childEnvironment({ NODE_OPTIONS: nodeOptions, ...env }),
		stdio: ['ignore', 'pipe', 'pipe']
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

const getSourceLocation = (frame: string) => {
	const match = frame.match(/main\.ts:(\d+):(\d+)\)?$/);

	return match ? { line: Number(match[1]), column: Number(match[2]) } : undefined;
};

describe('cli integration', () => {
	test.each([
		'({ answer: 42 })',
		'Object.assign(Object.create(null), { answer: 42 })',
		'import("node:path").then(({ sep }) => console.log(sep))',
	])('matches native print completion and imports: %s', async (code) => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });
		const native = await collect(spawn(process.execPath, ['-p', code], { cwd: fixture.path, env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] })).exited;
		for (const env of executionEnvironments) {
			const result = await runCli(['-p', code], fixture.path, env).exited;
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toBe(native.stdout);
			expect(result.stderr).toBe('');
		}
	});

	test.each([
		'console.log(`${import.meta.main}`)',
		'const { main } = import.meta; console.log(main)',
		'console.log(import /* split */ . meta /* split */ . main)',
		'console.log(import.meta["main"])',
	])('preserves entry and eval main semantics: %s', async (code) => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }), 'main.ts': code });
		for (const args of [['main.ts'], ['-e', code]]) {
			for (const env of executionEnvironments) {
				const result = await runCli(args, fixture.path, env).exited;
				expect(result.exitCode, result.stderr).toBe(0);
				expect(result.stdout.trim()).toBe('true');
			}
		}
	});

	test.each([
		{ flags: ['--no-warnings'] },
		{ flags: ['--conditions', 'development'] },
		{ flags: ['--enable-source-maps'] },
		{ flags: ['--'] },
	])('normalizes file URLs behind leading flags $flags', async ({ flags }) => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			'main.ts': 'console.log(JSON.stringify(process.argv.slice(1)))',
		});
		const entryPath = path.join(fixture.path, 'main.ts');
		for (const env of executionEnvironments) {
			const result = await runCli(['--no-cache', ...flags, pathToFileURL(entryPath).href, '--no-cache', '--', 'arg'], fixture.path, env).exited;
			expect(result.exitCode, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual([entryPath, '--no-cache', '--', 'arg']);
		}
	});

	test('removes runner flags after separated Node option values in eval', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });
		for (const env of executionEnvironments) {
			const result = await runCli(['--conditions', 'development', '--no-cache', '-e', 'console.log(42)'], fixture.path, env).exited;
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout.trim()).toBe('42');
		}
	});

	test('applies eval config before loading enum imports and inherits hooks in Workers', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			'custom.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@value': ['./value.ts'] } } }),
			'value.ts': 'export enum Value { Answer = 42 }',
			'worker.ts': 'enum Value { Answer = 42 }; console.log(Value.Answer)',
			'child.ts': 'enum Value { Answer = 42 }; console.log(Value.Answer)',
		});
		const code = `import { Value } from "@value"; import { Worker } from "node:worker_threads"; import { fork } from "node:child_process"; console.log(Value.Answer, process.env.TSNODE_DISABLE_CACHE); new Worker(new URL(${JSON.stringify(pathToFileURL(path.join(fixture.path, 'worker.ts')).href)})); fork(new URL(${JSON.stringify(pathToFileURL(path.join(fixture.path, 'child.ts')).href)}))`;
		for (const env of executionEnvironments) {
			const result = await runCli(['--no-cache', '--tsconfig', 'custom.json', '-e', code], fixture.path, env).exited;
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout.trim().split('\n')).toEqual(['42 1', '42', '42']);
		}
	});

	test('retains parent heap flags with native default Worker inheritance', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			'main.ts': 'import { Worker } from "node:worker_threads"; new Worker(new URL("./worker.ts", import.meta.url))',
			'worker.ts': 'import { getHeapStatistics } from "node:v8"; enum Value { Answer = 42 }; console.log(JSON.stringify({ heap: getHeapStatistics().heap_size_limit, answer: Value.Answer }))',
		});
		const flags = ['--max-old-space-size=128', '--conditions', 'development', '--enable-source-maps'];
		const nodeOptions = ['--experimental-strip-types', '--import', sourceResolveHookPath].join(' ');
		const native = await collect(spawn(process.execPath, [...flags, '--import', path.join(projectRoot, 'src/loader.ts'), 'main.ts'], {
			cwd: fixture.path, env: childEnvironment({ NODE_OPTIONS: nodeOptions }), stdio: ['ignore', 'pipe', 'pipe'],
		})).exited;
		expect(native.exitCode, native.stderr).toBe(0);
		const evalCode = `import { Worker } from "node:worker_threads"; new Worker(new URL(${JSON.stringify(pathToFileURL(path.join(fixture.path, 'worker.ts')).href)}))`;
		for (const args of [['main.ts'], ['-e', evalCode]]) {
			for (const env of executionEnvironments) {
				const result = await runCli(args, fixture.path, env, flags).exited;
				expect(result.exitCode, result.stderr).toBe(0);
				expect(result.stdout).toBe(native.stdout);
			}
		}
	});

	test.each([{ execArgv: [] }, { execArgv: ['--no-warnings'] }])('preserves explicit Worker execArgv $execArgv', async ({ execArgv }) => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			'main.ts': `import { Worker } from "node:worker_threads"; new Worker(new URL("./worker.js", import.meta.url), { execArgv: ${JSON.stringify(execArgv)} })`,
			'worker.js': 'console.log(JSON.stringify(process.execArgv))',
		});
		for (const env of executionEnvironments) {
			const result = await runCli(['main.ts'], fixture.path, env).exited;
			expect(result.exitCode, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual(execArgv);
		}
	});

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

	test.each([ '--eval', '--print', '--input-type', '--tsconfig' ])('rejects a missing string value for %s', async (option) => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli([option], fixture.path);
		const result = await exited;

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain(`Option ${option} requires a string value`);
	});

	test('uses the last repeated eval value', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli(['-e', 'console.log("first")', '--eval', 'console.log("second")'], fixture.path);
		const result = await exited;

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe('second');
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

	test('runs a .js entry through its TypeScript source', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'const value: number = 42; console.log(value);\n',
		});

		const { exited } = runCli(['main.js'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(result.stdout.trim()).toBe('42');
		expect(result.exitCode).toBe(0);
	});

	test('prints help without trying to run an entry', async () => {
		await using fixture = await createFixture({ 'package.json': JSON.stringify({ type: 'module' }) });

		const { exited } = runCli(['--help'], fixture.path);
		const result = await exited;

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Usage: tsnode [script path] [arguments]');
	});

	test('reports an unknown option while preserving the entry error', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log("ran");\n',
		});

		const { exited } = runCli(['--definitely-unknown', 'main.ts'], fixture.path);
		const result = await exited;

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).not.toContain('ran');
		expect(result.stderr).toContain('bad option: --definitely-unknown');
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

	test.skipIf(process.platform === 'win32').each([
		{ name: 'user handler', setup: 'process.on("SIGTERM", () => process.exit(23))', expected: 23 },
		{ name: 'removed handlers', setup: 'process.removeAllListeners("SIGTERM"); console.log(process.listenerCount("SIGTERM"))', expected: 143 },
	])('relays SIGTERM with $name', async ({ name, setup, expected }) => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			'main.ts': `
				const deadline = Date.now() + 5000;
				while (process.rawListeners('SIGTERM').length === 0) {
					if (Date.now() > deadline) { throw new Error('relay handler not installed') }
					await new Promise(resolve => setTimeout(resolve, 5));
				}
				${setup}; console.log('ready'); setInterval(() => {}, 1000);
			`,
		});
		const { childProcess, read, exited } = runCli(['main.ts'], fixture.path, {
			TSNODE_DISABLE_IN_PROCESS: '1', TSNODE_FORCE_SIGNAL_RELAY: '1', TSNODE_DISABLE_SIGNAL_RELAY: '0',
		});
		await waitForStdout(read, 'ready');
		if (name === 'removed handlers') { expect(read().stdout).toContain('0\n') }
		childProcess.kill('SIGTERM');
		expect((await exited).exitCode).toBe(expected);
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
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log(JSON.stringify({ ppid: process.ppid, argv1: process.argv[1] }));\n',
		});
		const entryPath = path.join(fixture.path, 'main.ts');
		const entryUrl = pathToFileURL(entryPath).href;

		const { exited } = runCli([entryUrl], fixture.path, { TSNODE_DISABLE_IN_PROCESS: '1' });
		const result = await exited;
		const parsed = JSON.parse(result.stdout.trim()) as { ppid: number; argv1: string };

		expect(parsed.ppid).not.toBe(process.pid);
		expect(parsed.argv1).toBe(entryPath);
		expect(result.exitCode).toBe(0);
	});

	test('forks when node flags without a runtime equivalent are present', async () => {
		await using fixture = await createFixture(parentPidFixture);

		// --trace-warnings has no runtime-equivalent API, so it must still force a fork
		const { exited } = runCli(['--trace-warnings', 'main.ts'], fixture.path);
		const result = await exited;

		expect(Number(result.stdout.trim())).not.toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('forks when an unsupported flag is mixed with a supported one', async () => {
		await using fixture = await createFixture(parentPidFixture);

		const { exited } = runCli(['--enable-source-maps', '--trace-warnings', 'main.ts'], fixture.path);
		const result = await exited;

		expect(Number(result.stdout.trim())).not.toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('runs in-process when --enable-source-maps is the only leading flag', async () => {
		await using fixture = await createFixture(parentPidFixture);

		const { exited } = runCli(['--enable-source-maps', 'main.ts'], fixture.path);
		const result = await exited;

		// Applied via the runtime-equivalent API instead of forcing a fork.
		expect(Number(result.stdout.trim())).toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('runs in-process when --enable-source-maps precedes the argument delimiter', async () => {
		await using fixture = await createFixture(parentPidFixture);

		const { exited } = runCli(['--enable-source-maps', '--', 'main.ts'], fixture.path);
		const result = await exited;

		expect(Number(result.stdout.trim())).toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('--enable-source-maps produces the same source-mapped stack trace in-process as forked', async () => {
		const stackTraceFixture = {
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			// The enum forces the esbuild fallback transform, which reflows line numbers,
			// so a correct stack trace line here can only come from real source-map remapping.
			'main.ts': [
				'enum Level { Low, High }',
				'',
				'function boom(): never {',
				'\tthrow new Error(String(Level.High));',
				'}',
				'',
				'console.log(JSON.stringify({ ppid: process.ppid }));',
				'',
				'try {',
				'\tboom();',
				'} catch (error) {',
				'\tconsole.log(JSON.stringify({ frame: (error as Error).stack?.split("\\n")[1] }));',
				'}',
				'',
			].join('\n'),
		};

		await using fixture = await createFixture(stackTraceFixture);

		const inProcess = await runCli(['--enable-source-maps', 'main.ts'], fixture.path).exited;
		const forked = await runCli(['--enable-source-maps', 'main.ts'], fixture.path, { TSNODE_DISABLE_IN_PROCESS: '1' }).exited;

		const [ inProcessPpidLine, inProcessFrameLine ] = inProcess.stdout.trim().split('\n');
		const [ forkedPpidLine, forkedFrameLine ] = forked.stdout.trim().split('\n');

		expect(Number((JSON.parse(inProcessPpidLine!) as { ppid: number }).ppid)).toBe(process.pid);
		expect(Number((JSON.parse(forkedPpidLine!) as { ppid: number }).ppid)).not.toBe(process.pid);

		const inProcessFrame = (JSON.parse(inProcessFrameLine!) as { frame: string }).frame;
		const forkedFrame = (JSON.parse(forkedFrameLine!) as { frame: string }).frame;

		expect(inProcessFrame).toContain('main.ts:4:');
		expect(forkedFrame).toContain('main.ts:4:');
		expect(getSourceLocation(inProcessFrame)).toEqual(getSourceLocation(forkedFrame));
		expect(inProcess.exitCode).toBe(0);
		expect(forked.exitCode).toBe(0);
	});

	test('forks an entry that reads import.meta.main so it is true, matching --import/forked behavior', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'console.log(JSON.stringify({ ppid: process.ppid, main: import.meta.main })); if (import.meta.main) { console.log("MAIN_RAN") }\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path);
		const result = await exited;
		const [ firstLine ] = result.stdout.trim().split('\n');
		const parsed = JSON.parse(firstLine!) as { ppid: number; main: boolean };

		// The in-process fast path can never make a dynamically imported module
		// report import.meta.main === true, so this entry must be forked.
		expect(parsed.ppid).not.toBe(process.pid);
		expect(parsed.main).toBe(true);
		expect(result.stdout).toContain('MAIN_RAN');
		expect(result.exitCode).toBe(0);
	});

	test('runs in-process when only a dependency (not the entry) reads import.meta.main', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'import "./dep.ts";\nconsole.log(process.ppid);\n',
			'dep.ts': 'console.log(JSON.stringify({ main: import.meta.main }));\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path);
		const result = await exited;
		const [ depLine, ppidLine ] = result.stdout.trim().split('\n');

		// A dependency module is never the process entry, in-process or forked.
		expect(JSON.parse(depLine!)).toEqual({ main: false });
		expect(Number(ppidLine)).toBe(process.pid);
		expect(result.exitCode).toBe(0);
	});

	test('an in-process entry can spawn a default Worker that still gets tsnode hooks', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'import { Worker } from "node:worker_threads";\nconst worker = new Worker(new URL("./worker.ts", import.meta.url));\nworker.on("error", (error) => { console.error(error); process.exitCode = 1 });\n',
			// `enum` is non-erasable TS syntax; requires tsnode's esbuild fallback, not Node's native strip.
			'worker.ts': 'enum Color { Red, Green }\nconsole.log(JSON.stringify({ ppid: process.ppid, color: Color.Red }));\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(JSON.parse(result.stdout.trim())).toEqual({ ppid: process.pid, color: 0 });
		expect(result.exitCode).toBe(0);
	});

	test('an in-process entry can fork() a default child that still gets tsnode hooks', async () => {
		await using fixture = await createFixture({
			'package.json': JSON.stringify({ type: 'module' }),
			...tsconfigForFixture,
			'main.ts': 'import { fork } from "node:child_process";\nconst child = fork(new URL("./child.ts", import.meta.url));\nchild.on("exit", (code) => process.exit(code ?? 1));\n',
			// `enum` is non-erasable TS syntax; requires tsnode's esbuild fallback, not Node's native strip.
			'child.ts': 'enum Color { Red, Green }\nconsole.log(JSON.stringify({ color: Color.Red }));\n',
		});

		const { exited } = runCli(['main.ts'], fixture.path);
		const result = await exited;

		expect(result.stderr).toBe('');
		expect(JSON.parse(result.stdout.trim())).toEqual({ color: 0 });
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
