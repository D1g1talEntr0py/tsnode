import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

type ChildExitListener = (exitCode: number | null) => void;

const mocks = vi.hoisted(() => {
	const watchPathMock = vi.fn(async () => {});
	const watchersCloseMock = vi.fn();
	const createChildProcess = (exitCode: number | null = 0, emitExitImmediately = true) => {
		const exitListeners: ChildExitListener[] = [];

		const child = {
			exitCode,
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
	const runMock = vi.fn(() => createChildProcess());

	let watchEventHandler: ((event: string, stats: unknown, targetPath: string, targetPathNext?: string) => void) | undefined;

	class WatchrMock {
		constructor(_targets: string | string[], _options: Record<string, unknown>, handler: (event: string, stats: unknown, targetPath: string, targetPathNext?: string) => void) {
			watchEventHandler = handler;
		}

		watchPath = watchPathMock;
		watchersClose = watchersCloseMock;
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
		watchPathMock,
		watchersCloseMock,
		runMock,
		createChildProcess,
		createIpcServerMock,
		getDataListener: () => dataListener,
		getWatchEventHandler: () => watchEventHandler,
		reset: () => {
			watchPathMock.mockReset();
			watchersCloseMock.mockReset();
			runMock.mockReset();
			createIpcServerMock.mockReset();
			dataListener = undefined;
			watchEventHandler = undefined;
		},
	};
});

vi.mock('@d1g1tal/watchr', () => ({
	Watchr: mocks.WatchrMock,
}));

vi.mock('../src/run', () => ({
	run: mocks.runMock,
}));

vi.mock('../src/utils/ipc/server', () => ({
	createIpcServer: mocks.createIpcServerMock,
}));

import { runWatchCommand } from '../src/watch/index';

describe('watch command', () => {
	let stdinDataHandler: (() => void) | undefined;

	beforeEach(() => {
		mocks.reset();
		vi.spyOn(process, 'on').mockImplementation(() => process);
		vi.spyOn(process.stdin, 'on').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
			if (event === 'data') {
				stdinDataHandler = () => listener();
			}

			return process.stdin;
		});
	});

	afterEach(() => {
		stdinDataHandler = undefined;
		vi.restoreAllMocks();
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
		watchEventHandler('change', undefined, 'entry.ts');
		watchEventHandler('change', undefined, 'entry.ts');

		await new Promise<void>(resolve => setImmediate(resolve));
		await new Promise<void>(resolve => setImmediate(resolve));

		expect(mocks.runMock).toHaveBeenCalledTimes(3);
	});

	test('closes runtime dependency watchers not used by the latest run', async () => {
		await runWatchCommand(['entry.ts']);

		const dataListener = mocks.getDataListener()!;
		dataListener({ type: 'dependency', path: '/tmp/first.ts' });
		stdinDataHandler!();
		dataListener({ type: 'dependency', path: '/tmp/second.ts' });
		stdinDataHandler!();

		expect(mocks.watchersCloseMock).toHaveBeenCalledTimes(1);
		expect(mocks.watchersCloseMock).toHaveBeenCalledWith('/tmp', '/tmp/first.ts');
		expect(mocks.watchPathMock).toHaveBeenCalledTimes(2);
	});
});