import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { WatchrStats, type WatchrEventHandler, type WatchrOptions } from '@d1g1tal/watchr';

type ChildExitListener = (exitCode: number | null) => void;

const mocks = vi.hoisted(() => {
	const closeMock = vi.fn();
	const startMock = vi.fn(() => Promise.resolve());
	const closeIpcServerMock = vi.fn(async () => {});
	const createChildProcess = (exitCode: number | null = 0, emitExitImmediately = true) => {
		const exitListeners: ChildExitListener[] = [];

		const child = {
			pid: 12345,
			signalCode: null,
			exitCode,
			removeListener: vi.fn(),
			kill: vi.fn(() => {
				if (emitExitImmediately) {
					child._emitExit(exitCode);
				} else {
					setImmediate(() => child._emitExit(exitCode));
				}
			}),
			once: vi.fn((event: string, handler: ChildExitListener) => {
				if (event === 'exit') {
					exitListeners.push(handler);
				}

				return child;
			}),
			_emitExit: (nextExitCode: number | null) => {
				for (const listener of exitListeners.splice(0)) {
					listener(nextExitCode);
				}
			},
		} as unknown as ChildProcess & { _emitExit: (exitCode: number | null) => void };

		return child;
	};
	const runMock = vi.fn((): ChildProcess => createChildProcess());

	const watchers: WatchrMock[] = [];

	class WatchrMock {
		close = vi.fn(() => { closeMock() });
		constructor(readonly targets: string | string[], readonly options: WatchrOptions) {
			watchers.push(this);
		}

		async start() {
			await startMock();
			return this;
		}
	}

	let dataListener: ((payload: unknown) => void) | undefined;
	const createIpcServerMock = vi.fn(async () => ({
		on: vi.fn((event: string, listener: (payload: unknown) => void) => {
			if (event === 'data') {
				dataListener = listener;
			}
		}),
	}));

	return {
		WatchrMock,
		watchers,
		closeMock,
		startMock,
		closeIpcServerMock,
		runMock,
		createChildProcess,
		createIpcServerMock,
		getDataListener: () => dataListener,
		getWatchEventHandler: () => watchers[0]!.options.handlers!.all as WatchrEventHandler<'all'>,
		reset: () => {
			watchers.length = 0;
			closeMock.mockClear();
			startMock.mockReset().mockResolvedValue(undefined);
			closeIpcServerMock.mockClear();
			runMock.mockReset();
			createIpcServerMock.mockReset();
			dataListener = undefined;
		},
	};
});

vi.mock('@d1g1tal/watchr', async importOriginal => ({
	...await importOriginal<typeof import('@d1g1tal/watchr')>(),
	Watchr: mocks.WatchrMock,
}));

vi.mock('../src/run', () => ({
	run: mocks.runMock,
}));

vi.mock('../src/utils/ipc/server', () => ({
	createIpcServer: mocks.createIpcServerMock,
	closeIpcServer: mocks.closeIpcServerMock,
}));

import { runWatchCommand, terminateProcess } from '../src/watch/index';

const changeEvent = () => ({ type: 'change', path: 'entry.ts', stats: WatchrStats.synthetic(false), initial: false } as const);
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

describe('watch command', () => {
	let stdinDataHandler: (() => void) | undefined;
	const signalHandlers = new Map<string | symbol, (...args: unknown[]) => void>();

	beforeEach(() => {
		mocks.reset();
		vi.spyOn(process, 'on').mockImplementation((event, listener) => {
			signalHandlers.set(event, listener);
			return process;
		});
		vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, 'on').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
			if (event === 'data') {
				stdinDataHandler = () => listener();
			}

			return process.stdin;
		});
	});

	afterEach(() => {
		signalHandlers.clear();
		vi.useRealTimers();
		process.exitCode = 0;
		stdinDataHandler = undefined;
		vi.restoreAllMocks();
	});

	test('does not spawn before Watchr is ready', async () => {
		let ready: () => void = () => {};
		mocks.startMock.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve }));
		const starting = runWatchCommand(['entry.ts']);
		await new Promise<void>(resolve => setImmediate(resolve));
		mocks.getWatchEventHandler()(changeEvent());
		expect(mocks.runMock).not.toHaveBeenCalled();
		ready();
		await starting;
		expect(mocks.runMock).toHaveBeenCalledOnce();
	});

	test('shares concurrent termination and bounds a child that never exits', async () => {
		vi.useFakeTimers();
		const child = new EventEmitter() as ChildProcess;
		Object.assign(child, { pid: 12345, exitCode: null, signalCode: null, kill: vi.fn(() => false) });
		const first = terminateProcess(child, 'SIGTERM', 10);
		expect(terminateProcess(child)).toBe(first);
		const rejected = expect(first).rejects.toThrow('did not terminate');
		await vi.advanceTimersByTimeAsync(1010);
		await rejected;
		expect(child.kill).toHaveBeenCalledWith('SIGKILL');
		expect(child.listenerCount('exit')).toBe(0);
		expect(child.listenerCount('error')).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('settles termination errors and skips children with no process', async () => {
		const child = new EventEmitter() as ChildProcess;
		Object.assign(child, { pid: 12345, exitCode: null, signalCode: null, kill: vi.fn(() => child.emit('error', new Error('kill failed'))) });
		await expect(terminateProcess(child)).rejects.toThrow('kill failed');
		expect(child.listenerCount('exit')).toBe(0);
		Object.assign(child, { pid: undefined });
		await expect(terminateProcess(child)).resolves.toBeNull();
		expect(child.kill).toHaveBeenCalledOnce();
	});

	test('cleans up once when concurrent signals arrive after a signal exit', async () => {
		const child = mocks.createChildProcess(null);
		Object.assign(child, { signalCode: 'SIGTERM' });
		mocks.runMock.mockReturnValueOnce(child);
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		await runWatchCommand(['entry.ts']);
		signalHandlers.get('SIGINT')!('SIGINT');
		signalHandlers.get('SIGTERM')!('SIGTERM');
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(child.kill).not.toHaveBeenCalled();
		expect(mocks.closeMock).toHaveBeenCalledOnce();
		expect(mocks.closeIpcServerMock).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(0);
		expect(exit).toHaveBeenCalledOnce();
	});

	test('a second shutdown signal escalates a live child without creating another waiter', async () => {
		const child = new EventEmitter() as ChildProcess;
		Object.assign(child, {
			pid: 12345, exitCode: null, signalCode: null,
			kill: vi.fn((signal: string) => {
				if (signal === 'SIGKILL') {
					Object.assign(child, { signalCode: signal });
					child.emit('exit', null, signal);
				}
				return true;
			})
		});
		mocks.runMock.mockReturnValueOnce(child);
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		await runWatchCommand(['entry.ts']);
		signalHandlers.get('SIGINT')!('SIGINT');
		signalHandlers.get('SIGTERM')!('SIGTERM');
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGINT');
		expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
		expect(child.listenerCount('exit')).toBe(0);
		expect(mocks.closeMock).toHaveBeenCalledOnce();
		expect(mocks.closeIpcServerMock).toHaveBeenCalledOnce();
	});

	test('preserves signal status when a live child exits before the IPC relay binds', async () => {
		const child = new EventEmitter() as ChildProcess;
		Object.assign(child, {
			pid: 12345, exitCode: null, signalCode: null,
			kill: vi.fn((signal: string) => {
				Object.assign(child, { signalCode: signal });
				child.emit('exit', null, signal);
				return true;
			})
		});
		mocks.runMock.mockReturnValueOnce(child);
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		await runWatchCommand(['entry.ts']);
		signalHandlers.get('SIGINT')!('SIGINT');
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(exit).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(130);
		expect(mocks.closeMock).toHaveBeenCalledOnce();
		expect(mocks.closeIpcServerMock).toHaveBeenCalledOnce();
	});

	test('dependency overflow fails visibly and terminates the child instead of continuing incomplete coverage', async () => {
		const child = mocks.createChildProcess(null);
		mocks.runMock.mockReturnValueOnce(child);
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await runWatchCommand(['entry.ts']);
		mocks.getDataListener()!({ type: 'dependency-overflow' });
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(process.exitCode).toBe(1);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining('coverage is incomplete'));
		expect(child.kill).toHaveBeenCalledOnce();
		expect(mocks.closeMock).toHaveBeenCalledOnce();
		expect(mocks.closeIpcServerMock).toHaveBeenCalledOnce();
	});

	test('waits for readiness and cleans up a rejected startup without spawning', async () => {
		mocks.startMock.mockRejectedValueOnce(new Error('Path not found'));
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await runWatchCommand(['--include', 'missing.ts', 'entry.ts']);
		expect(mocks.runMock).not.toHaveBeenCalled();
		expect(mocks.closeMock).toHaveBeenCalledOnce();
		expect(mocks.closeIpcServerMock).toHaveBeenCalledOnce();
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Path not found'));
	});

	test('terminates an immediately exiting child without missing the exit event', async () => {
		const child = mocks.createChildProcess(null);
		await expect(terminateProcess(child)).resolves.toBeNull();
		expect(child.kill).toHaveBeenCalledOnce();
	});

	test('does not kill children that have already exited by signal', async () => {
		const child = mocks.createChildProcess(null);
		Object.assign(child, { signalCode: 'SIGTERM' });
		await expect(terminateProcess(child)).resolves.toBeNull();
		expect(child.kill).not.toHaveBeenCalled();
		mocks.runMock.mockReturnValueOnce(child);
		await runWatchCommand(['entry.ts']);
		stdinDataHandler!();
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(mocks.runMock).toHaveBeenCalledTimes(2);
	});

	test('cleans up child and resources when a dynamic dependency cannot be watched', async () => {
		const child = mocks.createChildProcess(null);
		mocks.runMock.mockReturnValueOnce(child);
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await runWatchCommand(['entry.ts']);
		mocks.startMock.mockRejectedValueOnce(new Error('Path not found'));
		mocks.getDataListener()!({ type: 'dependency', path: '/missing/dependency.ts' });
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(child.kill).toHaveBeenCalledOnce();
		expect(mocks.closeMock).toHaveBeenCalledTimes(2);
		expect(mocks.closeIpcServerMock).toHaveBeenCalledOnce();
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/missing/dependency.ts'));
	});

	test('coalesces queued reruns while a previous rerun is still finishing', async () => {
		const initialChild = mocks.createChildProcess(0, false);
		const restartedChild = mocks.createChildProcess(0, false);
		const secondRestartChild = mocks.createChildProcess(0, false);

		mocks.runMock
			.mockImplementationOnce(() => initialChild)
			.mockImplementationOnce(() => restartedChild)
			.mockImplementationOnce(() => secondRestartChild);

		await runWatchCommand(['entry.ts']);

		const watchEventHandler = mocks.getWatchEventHandler()!;
		watchEventHandler(changeEvent());
		watchEventHandler(changeEvent());

		await new Promise<void>(resolve => setImmediate(resolve));
		await new Promise<void>(resolve => setImmediate(resolve));

		expect(mocks.runMock).toHaveBeenCalledTimes(3);
	});

	test('closes runtime dependency watchers not used by the latest run', async () => {
		await runWatchCommand(['entry.ts']);

		const dataListener = mocks.getDataListener()!;
		dataListener({ type: 'signal', signal: 'SIGINT' });
		dataListener({ type: 'dependency', path: 42 });
		dataListener({ type: 'dependency', path: '/tmp/first.ts' });
		await new Promise<void>(resolve => setImmediate(resolve));
		stdinDataHandler!();
		await new Promise<void>(resolve => setImmediate(resolve));
		dataListener({ type: 'dependency', path: '/tmp/second.ts' });
		await new Promise<void>(resolve => setImmediate(resolve));
		stdinDataHandler!();
		await new Promise<void>(resolve => setImmediate(resolve));

		expect(mocks.watchers).toHaveLength(3);
		expect(mocks.watchers[0]!.close).not.toHaveBeenCalled();
		expect(mocks.watchers[1]!.targets).toBe('/tmp/first.ts');
		expect(mocks.watchers[1]!.close).toHaveBeenCalledOnce();
		expect(mocks.watchers[2]!.targets).toBe('/tmp/second.ts');
		expect(mocks.watchers[2]!.close).not.toHaveBeenCalled();
	});

	test('uses configured payload handlers without initial reruns and logs rename destinations', async () => {
		const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
		await runWatchCommand(['--clear-screen=false', 'entry.ts']);
		expect(mocks.watchers[0]!.options).toMatchObject({ emitInitial: false, recursive: true });
		expect(mocks.watchers[0]!.options).not.toHaveProperty('debounce');
		mocks.getWatchEventHandler()({ ...changeEvent(), type: 'add', initial: true });
		await settle();
		expect(mocks.runMock).toHaveBeenCalledOnce();
		mocks.getWatchEventHandler()({
			type: 'rename', from: '/tmp/old.ts', to: '/tmp/new.ts',
			stats: WatchrStats.synthetic(false), initial: false,
		});
		await settle();
		expect(mocks.runMock).toHaveBeenCalledTimes(2);
		expect(stdout).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.stringContaining('/tmp/new.ts'), expect.any(String));
	});

	test('reports operational errors through configured handlers and shuts down every watcher', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await runWatchCommand(['entry.ts']);
		mocks.getDataListener()!({ type: 'dependency', path: '/tmp/dep.ts' });
		await settle();
		const onError = mocks.watchers[1]!.options.handlers!.error as WatchrEventHandler<'error'>;
		onError(new Error('native watcher failed'));
		await settle();
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining('native watcher failed'));
		expect(mocks.closeMock).toHaveBeenCalledTimes(2);
		expect(mocks.closeIpcServerMock).toHaveBeenCalledOnce();
		expect(process.exitCode).toBe(1);
	});

	test('deduplicates pending dependencies and preserves overlapping explicit include coverage', async () => {
		await runWatchCommand(['--include', '/tmp/included', 'entry.ts']);
		const pending = Promise.withResolvers<void>();
		mocks.startMock.mockReturnValueOnce(pending.promise);
		const data = mocks.getDataListener()!;
		data({ type: 'dependency', path: '/tmp/included/dep.ts' });
		data({ type: 'dependency', path: `${process.cwd()}/entry.ts` });
		data({ type: 'dependency', path: '/tmp/included-other/dep.ts' });
		data({ type: 'dependency', path: 'file:///tmp/included-other/dep.ts' });
		expect(mocks.watchers).toHaveLength(2);
		expect(mocks.startMock).toHaveBeenCalledTimes(2);
		pending.resolve();
		await settle();
		stdinDataHandler!();
		await settle();
		stdinDataHandler!();
		await settle();
		expect(mocks.watchers[0]!.close).not.toHaveBeenCalled();
		expect(mocks.watchers[1]!.close).toHaveBeenCalledOnce();
	});

	test('waits for pending dependency starts before reconciling and coalesces reruns', async () => {
		await runWatchCommand(['entry.ts']);
		const pending = Promise.withResolvers<void>();
		mocks.startMock.mockReturnValueOnce(pending.promise);
		mocks.getDataListener()!({ type: 'dependency', path: '/tmp/dep.ts' });
		stdinDataHandler!();
		stdinDataHandler!();
		await settle();
		expect(mocks.runMock).toHaveBeenCalledOnce();
		pending.resolve();
		await settle();
		expect(mocks.runMock).toHaveBeenCalledTimes(3);
		expect(mocks.watchers[1]!.close).toHaveBeenCalledOnce();
	});

	test('queues live dependency events during startup until registration completes', async () => {
		await runWatchCommand(['entry.ts']);
		const pending = Promise.withResolvers<void>();
		mocks.startMock.mockReturnValueOnce(pending.promise);
		mocks.getDataListener()!({ type: 'dependency', path: '/tmp/dep.ts' });
		const onEvent = mocks.watchers[1]!.options.handlers!.all as WatchrEventHandler<'all'>;
		onEvent({ ...changeEvent(), path: '/tmp/dep.ts' });
		await settle();
		expect(mocks.runMock).toHaveBeenCalledOnce();
		expect(mocks.watchers[1]!.close).not.toHaveBeenCalled();
		pending.resolve();
		await settle();
		expect(mocks.runMock).toHaveBeenCalledTimes(2);
		expect(mocks.watchers[1]!.close).not.toHaveBeenCalled();
	});

	test.each([false, true])('closes pending dependency starts on shutdown (reject=%s)', async (reject) => {
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await runWatchCommand(['entry.ts']);
		const pending = Promise.withResolvers<void>();
		mocks.startMock.mockReturnValueOnce(pending.promise);
		mocks.getDataListener()!({ type: 'dependency', path: '/tmp/dep.ts' });
		signalHandlers.get('SIGINT')!('SIGINT');
		if (reject) { pending.reject(new Error('closed during startup')) } else { pending.resolve() }
		await settle();
		mocks.getDataListener()!({ type: 'dependency', path: '/tmp/late.ts' });
		expect(mocks.watchers).toHaveLength(2);
		expect(mocks.closeMock).toHaveBeenCalledTimes(2);
		expect(mocks.runMock).toHaveBeenCalledOnce();
		expect(stderr).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(0);
	});
});