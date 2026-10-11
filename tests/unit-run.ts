import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	spawn: spawnMock,
}));

import { run } from '../src/run';

describe('run', () => {
	afterEach(() => {
		spawnMock.mockReset();
		delete process.env['TSNODE_DISABLE_CACHE'];
		delete process.env['TSNODE_SIGNAL_RELAY'];
		delete process.env['TSNODE_IPC'];
		delete process.env['TSNODE_DEPENDENCY_REPORTING'];
		delete process.env['TSNODE_TSCONFIG_PATH'];
	});

	const spawnedEnv = () => spawnMock.mock.calls[0]![2].env;
	const spawnedArgs = () => spawnMock.mock.calls[0]![1] as string[];
	const hasPreload = (name: string) => spawnedArgs().some(arg => arg.includes(`/${name}.js`));

	test('inherits parent flags without eval payloads or duplicate loader imports', () => {
		const original = process.execArgv;
		try {
			process.execArgv = ['--max-old-space-size=128', '--conditions', 'development', '--input-type', 'module', '-e', 'parent code', '--import', new URL('../src/loader.js', import.meta.url).href];
			run(['--conditions', 'development', 'input.ts'], { signalRelay: false });
			expect(spawnedArgs()).toEqual(['--max-old-space-size=128', '--import', new URL('../src/loader.js', import.meta.url).href, '--conditions', 'development', 'input.ts']);
		} finally {
			process.execArgv = original;
		}
	});

	test('passes per-run env overrides without mutating process.env', () => {
		run(['input.ts'], {
			noCache: true,
			signalRelay: false,
			ipc: true,
			tsconfigPath: '/tmp/tsnode-tsconfig.json',
		});

		expect(process.env['TSNODE_DISABLE_CACHE']).toBeUndefined();
		expect(process.env['TSNODE_SIGNAL_RELAY']).toBeUndefined();
		expect(process.env['TSNODE_IPC']).toBeUndefined();
		expect(process.env['TSNODE_TSCONFIG_PATH']).toBeUndefined();

		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [command, args, options] = spawnMock.mock.calls[0]!;

		expect(command).toBe(process.execPath);
		expect(args).toContain('--import');
		expect(options.env).not.toBe(process.env);
		expect(options.env.TSNODE_DISABLE_CACHE).toBe('1');
		expect(options.env.TSNODE_SIGNAL_RELAY).toBe('0');
		expect(options.env.TSNODE_IPC).toBe('1');
		expect(options.env.TSNODE_TSCONFIG_PATH).toBe('/tmp/tsnode-tsconfig.json');
	});

	test('enables the IPC socket when the signal relay is on', () => {
		// Regression: the relay used to preload preflight.js without setting
		// TSNODE_IPC, so the child never connected and no handlers were bound.
		run(['input.ts'], { signalRelay: true });

		expect(spawnedEnv().TSNODE_IPC).toBe('1');
		expect(spawnedEnv().TSNODE_SIGNAL_RELAY).toBeUndefined();
		expect(hasPreload('preflight')).toBe(true);
	});

	test('does not enable dependency reporting for the signal relay', () => {
		run(['input.ts'], { signalRelay: true });

		// Watch-mode only: otherwise every module load sends an IPC message.
		expect(spawnedEnv().TSNODE_DEPENDENCY_REPORTING).toBeUndefined();
	});

	test('enables dependency reporting for watch mode', () => {
		run(['input.ts'], { ipc: true });

		expect(spawnedEnv().TSNODE_DEPENDENCY_REPORTING).toBe('1');
		expect(spawnedEnv().TSNODE_IPC).toBe('1');
	});

	test('skips the preflight preload when nothing needs the socket', () => {
		run(['input.ts'], { signalRelay: false });

		expect(spawnedEnv().TSNODE_IPC).toBeUndefined();
		expect(hasPreload('preflight')).toBe(false);
		expect(hasPreload('loader')).toBe(true);
	});

	test('adds an IPC channel when run is called from a spawned process with IPC', async () => {
		const sourceResolveHookPath = path.resolve('tests/utils/source-resolve-hook.ts');
		const driver = `
			const { run } = await import(${JSON.stringify(path.resolve('src/run.ts'))});
			const child = run(['-e', 'process.send?.("child-message")'], { signalRelay: false });
			child.on('message', message => process.send?.(message));
			child.on('close', code => process.exit(code ?? 1));
		`;
		const realSpawn = process.getBuiltinModule('node:child_process')!.spawn;
		const childProcess = realSpawn(process.execPath, [
			'--experimental-strip-types', '--import', sourceResolveHookPath, '--input-type=module', '-e', driver,
		], {
			env: { ...process.env, NODE_OPTIONS: `--experimental-strip-types --import ${sourceResolveHookPath}` },
			stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
		});
		let message: unknown;
		let stderr = '';
		childProcess.stderr!.setEncoding('utf-8');
		childProcess.stderr!.on('data', (chunk: string) => { stderr += chunk; });
		childProcess.on('message', value => { message = value; });

		expect(await new Promise<number>((resolve) => childProcess.once('close', code => resolve(code ?? 1))), stderr).toBe(0);
		expect(message).toBe('child-message');
	});
});