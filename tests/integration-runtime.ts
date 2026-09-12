import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createProjectFixture } from './utils/fixture';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceResolveHookPath = path.join(import.meta.dirname, 'utils/source-resolve-hook.ts');
const cliPath = path.join(projectRoot, 'src/cli.ts');
const runtimePath = (name: string) => pathToFileURL(`${projectRoot}/src/${name}.ts`).href;

type Result = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

const collect = (childProcess: ChildProcess) => {
	let stdout = '';
	let stderr = '';
	childProcess.stdout?.setEncoding('utf8');
	childProcess.stderr?.setEncoding('utf8');
	childProcess.stdout?.on('data', (chunk: string) => { stdout += chunk; });
	childProcess.stderr?.on('data', (chunk: string) => { stderr += chunk; });

	return new Promise<Result>((resolve) => {
		childProcess.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
	});
};

const nodeEnvironment = (env: Record<string, string> = {}) => ({
	...process.env,
	NODE_OPTIONS: [ process.env.NODE_OPTIONS, '--experimental-strip-types', '--import', sourceResolveHookPath ].filter(Boolean).join(' '),
	...env,
});

const runModule = async (script: string, cwd: string, env?: Record<string, string>) => {
	const result = await execFileAsync(process.execPath, [
		'--experimental-strip-types',
		'--import', sourceResolveHookPath,
		'--input-type=module',
		'--eval', script,
	], { cwd, env: nodeEnvironment(env) });

	return result;
};

const waitForStdout = (childProcess: ChildProcess, marker: string) => new Promise<void>((resolve, reject) => {
	let stdout = '';
	const timeout = setTimeout(() => reject(new Error(`Timed out waiting for "${marker}"`)), 30_000);
	const onData = (chunk: string) => {
		stdout += chunk;
		if (stdout.includes(marker)) {
			clearTimeout(timeout);
			childProcess.stdout!.off('data', onData);
			resolve();
		}
	};
	childProcess.stdout!.setEncoding('utf8');
	childProcess.stdout!.on('data', onData);
});

describe('runtime integration', () => {
	test('runs a TypeScript entry through runInProcess with script argv', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': 'console.log(JSON.stringify({ ppid: process.ppid, argv: process.argv.slice(1) }));\n',
		});
		const entryPath = path.join(fixture.path, 'entry.ts');
		const result = await runModule(`
			import { runInProcess } from ${JSON.stringify(runtimePath('run-in-process'))};
			await runInProcess(${JSON.stringify([entryPath, 'one', 'two'])});
		`, fixture.path);

		expect(JSON.parse(result.stdout)).toEqual({ ppid: process.pid, argv: [ entryPath, 'one', 'two' ] });
		expect(result.stderr).toBe('');
	});

	test('does not duplicate an inherited loader supplied as a relative import path', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': 'console.log(JSON.stringify(process.execArgv));\n',
		});
		const loaderPath = path.join(projectRoot, 'src/loader.js');
		const relativeLoaderPath = path.relative(fixture.path, loaderPath);
		const relativeImport = relativeLoaderPath.startsWith('.') ? relativeLoaderPath : `./${relativeLoaderPath}`;
		const result = await runModule(`
			process.execArgv = ['--import', ${JSON.stringify(relativeImport)}];
			import { runInProcess } from ${JSON.stringify(runtimePath('run-in-process'))};
			await runInProcess(['entry.ts']);
		`, fixture.path);

		expect(JSON.parse(result.stdout)).toEqual([ '--import', relativeImport ]);
		expect(result.stderr).toBe('');
	});

	test('runs eval and print code through their in-process runners', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runModule(`
			import { runEvalInProcess, runPrintInProcess } from ${JSON.stringify(runtimePath('run-eval-in-process'))};
			await runEvalInProcess('console.log(JSON.stringify(process.argv.slice(1)));', [ 'eval-arg' ]);
			await runPrintInProcess('1 + 2', []);
		`, fixture.path);

		expect(result.stdout.trim().split('\n')).toEqual([ '["eval-arg"]', '3' ]);
		expect(result.stderr).toBe('');
	});

	test('executes TypeScript supplied on stdin', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const childProcess = spawn(process.execPath, [cliPath], {
			cwd: fixture.path,
			env: nodeEnvironment(),
			stdio: [ 'pipe', 'pipe', 'pipe' ],
		});
		const resultPromise = collect(childProcess);
		childProcess.stdin!.end('const value: number = 40; console.log(value + 2);\n');
		const result = await resultPromise;

		expect(result.stdout.trim()).toBe('42');
		expect(result.stderr).toBe('');
		expect(result.exitCode).toBe(0);
	});

	test('transforms TypeScript input in the patched REPL', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const childProcess = spawn(process.execPath, [
			'--experimental-strip-types',
			'--import', sourceResolveHookPath,
			'--input-type=module',
			'--eval', `
				import ${JSON.stringify(runtimePath('repl'))};
				import repl from 'node:repl';
				repl.start({ prompt: '> ' });
			`,
		], {
			cwd: fixture.path,
			env: nodeEnvironment(),
			stdio: [ 'pipe', 'pipe', 'pipe' ],
		});
		const resultPromise = collect(childProcess);
		await waitForStdout(childProcess, '> ');
		childProcess.stdin!.end('const value: number = 40; console.log(value + 2)\n.exit\n');
		const result = await resultPromise;

		expect(result.stdout).toContain('42');
		expect(result.stderr).toBe('');
		expect(result.exitCode).toBe(0);
	});

	test('initializes the preflight preload for a forced relay child', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': 'console.log("preflight-ready");\n',
		});
		const childProcess = spawn(process.execPath, [cliPath, 'entry.ts'], {
			cwd: fixture.path,
			env: nodeEnvironment({
				TSNODE_DISABLE_IN_PROCESS: '1',
				TSNODE_FORCE_SIGNAL_RELAY: '1',
				TSNODE_DISABLE_SIGNAL_RELAY: '0',
			}),
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		});
		const result = await collect(childProcess);

		expect(result.stdout.trim()).toBe('preflight-ready');
		expect(result.stderr).toBe('');
		expect(result.exitCode).toBe(0);
	});
});