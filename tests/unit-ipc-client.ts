import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createIpcServer } from '../src/utils/ipc/server';
import { getPipePath } from '../src/utils/ipc/get-pipe-path';
import { createIpcSender, ipcQueueLimits } from '../src/utils/ipc/client';
import { Json } from '../src/utils/json';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceResolveHookPath = path.join(projectRoot, 'tests/utils/source-resolve-hook.ts');
const clientPath = path.join(projectRoot, 'src/utils/ipc/client.ts');

const runClient = (code: string, env: Record<string, string>) => spawn(process.execPath, [
	'--experimental-strip-types',
	'--import', sourceResolveHookPath,
	'--input-type=module',
	'-e', code,
	], {
	env: { ...process.env, ...env },
	'stdio': ['ignore', 'pipe', 'pipe'],
});

const collect = (childProcess: ReturnType<typeof runClient>) => {
	let stdout = '';
	let stderr = '';
	childProcess.stdout!.setEncoding('utf-8');
	childProcess.stdout!.on('data', (chunk: string) => { stdout += chunk; });
	childProcess.stderr!.setEncoding('utf-8');
	childProcess.stderr!.on('data', (chunk: string) => { stderr += chunk; });
	return {
		stdout: () => stdout,
		stderr: () => stderr,
		exited: new Promise<number>((resolve) => childProcess.on('close', (code) => resolve(code ?? -1))),
	};
};

describe('IPC client', () => {
	let server: net.Server | undefined;

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
	});

	test('rejects messages whose toJSON returns undefined without queueing them', () => {
		const sender = createIpcSender();

		expect(() => sender.send({ type: 'signal', signal: 'SIGINT', toJSON: () => undefined })).toThrow('IPC message must serialize to JSON');
		expect(sender.stats().queuedMessages).toBe(0);
	});

	test('bounds queued traffic, coalesces dependencies, and prioritizes signals after drain', () => {
		const sender = createIpcSender();
		const socket = new EventEmitter() as net.Socket;
		const written: unknown[] = [];
		socket.write = vi.fn((buffer: Buffer) => {
			written.push(Json.parse(buffer.subarray(4).toString()));
			return false;
		}) as typeof socket.write;
		socket.destroy = vi.fn(() => socket);
		socket.ref = vi.fn(() => socket);
		socket.unref = vi.fn(() => socket);
		sender.send({ type: 'dependency', path: '/first.ts' });
		sender.send({ type: 'dependency', path: '/first.ts' });
		expect(sender.stats().queuedMessages).toBe(1);
		sender.connect(socket);
		sender.send({ type: 'dependency', path: '/second.ts' });
		sender.send({ type: 'signal', signal: 'SIGINT' });
		expect(written).toHaveLength(1);
		socket.emit('drain');
		expect(written[1]).toEqual({ type: 'signal', signal: 'SIGINT' });
		for (let index = 0; index < ipcQueueLimits.messages + 10; index += 1) {
			sender.send({ type: 'dependency', path: `/dependency-${index}.ts` });
		}
		expect(sender.stats().queuedBytes).toBeLessThanOrEqual(ipcQueueLimits.bytes);
		expect(sender.stats().queuedMessages).toBe(1);
		socket.emit('drain');
		expect(written[2]).toMatchObject({ type: 'dependency-overflow' });
		socket.emit('close');
		expect(sender.stats().queuedBytes).toBe(0);
	});

	test('bounds startup bytes and makes a captured sender inert after disconnect', () => {
		const disconnected = vi.fn();
		const sender = createIpcSender(disconnected);
		for (let index = 0; index < 100; index += 1) {
			sender.send({ type: 'dependency', path: `/${index}-${'x'.repeat(32_000)}` });
		}
		expect(sender.stats().queuedBytes).toBeLessThanOrEqual(ipcQueueLimits.bytes);
		expect(sender.stats().queuedMessages).toBe(1);
		const captured = sender.send;
		sender.disconnect();
		captured({ type: 'signal', signal: 'SIGTERM' });
		expect(sender.stats().queuedMessages).toBe(0);
		expect(disconnected).toHaveBeenCalledOnce();
	});

	test('bounds actual stalled-reader traffic and delivers overflow plus a prioritized signal', async () => {
		const pipePath = getPipePath(process.pid);
		server = await createIpcServer(pipePath);
		let reader: net.Socket | undefined;
		server.on('connection', socket => { reader = socket; socket.pause(); });
		const messages: Array<Record<string, unknown>> = [];
		server.on('data', message => messages.push(message));
		const socket = net.createConnection(pipePath);
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', resolve);
			socket.once('error', reject);
		});
		const sender = createIpcSender();
		try {
			sender.connect(socket);
			for (let index = 0; index < 200; index += 1) {
				sender.send({ type: 'dependency', path: `/${index}-${'x'.repeat(32_000)}` });
			}
			sender.send({ type: 'signal', signal: 'SIGINT' });
			expect(sender.stats().queuedBytes).toBeLessThanOrEqual(ipcQueueLimits.bytes);
			expect(socket.writableLength).toBeLessThanOrEqual(socket.writableHighWaterMark + ipcQueueLimits.frameBytes);
			reader!.resume();
			await expect.poll(() => messages.some(message => message['type'] === 'dependency-overflow')).toBe(true);
			const signalIndex = messages.findIndex(message => message['type'] === 'signal');
			const overflowIndex = messages.findIndex(message => message['type'] === 'dependency-overflow');
			expect(signalIndex).toBeGreaterThanOrEqual(0);
			expect(signalIndex).toBeLessThan(overflowIndex);
			await expect.poll(() => sender.stats().queuedBytes).toBe(0);
		} finally {
			sender.disconnect();
		}
	});

	test('invalidates the published and captured senders when the server disconnects after connect', async () => {
		server = await createIpcServer(getPipePath(process.pid));
		server.on('connection', socket => socket.once('data', () => socket.destroy()));
		const childProcess = runClient(`
			const { parent, connectingToServer } = await import(${Json.serialize(clientPath)});
			const captured = await connectingToServer;
			captured({ type: 'signal', signal: 'SIGINT' });
			const deadline = setTimeout(() => process.exit(1), 2000);
			const check = setInterval(() => {
				if (parent.send === undefined) {
					captured({ type: 'dependency', path: '/after-close.ts' });
					console.log('disconnected');
					clearInterval(check);
					clearTimeout(deadline);
				}
			}, 10);
		`, { TSNODE_IPC: '1', TSNODE_DEPENDENCY_REPORTING: '1' });
		const child = collect(childProcess);
		expect(await child.exited).toBe(0);
		expect(child.stdout().trim()).toBe('disconnected');
		expect(child.stderr()).toContain('TSNODE_IPC_DISCONNECTED');
	});

	test('reports startup dependency overflow without dropping a queued signal', async () => {
		server = await createIpcServer(getPipePath(process.pid));
		const messages: Array<Record<string, unknown>> = [];
		server.on('data', message => messages.push(message));
		const childProcess = runClient(`
			const { parent, connectingToServer } = await import(${Json.serialize(clientPath)});
			for (let index = 0; index < 1100; index += 1) parent.send({ type: 'dependency', path: '/startup-' + index + '.ts' });
			parent.send({ type: 'signal', signal: 'SIGTERM' });
			await connectingToServer;
		`, { TSNODE_IPC: '1', TSNODE_DEPENDENCY_REPORTING: '1', TSNODE_SIGNAL_RELAY: '0' });
		const child = collect(childProcess);
		expect(await child.exited).toBe(0);
		await expect.poll(() => messages.length).toBe(2);
		expect(messages[0]).toEqual({ type: 'signal', signal: 'SIGTERM' });
		expect(messages[1]).toMatchObject({ type: 'dependency-overflow' });
		expect(child.stderr()).toBe('');
	});

	test('fails explicitly rather than dropping excess control messages', () => {
		const sender = createIpcSender();
		for (let index = 0; index < ipcQueueLimits.controls; index += 1) {
			sender.send({ type: 'signal', signal: 'SIGINT' });
		}
		expect(() => sender.send({ type: 'signal', signal: 'SIGTERM' })).toThrow('control queue capacity');
		sender.disconnect();
	});

	test('reserves overflow notification bytes even when controls nearly fill the byte budget', () => {
		const sender = createIpcSender();
		for (let index = 0; index < 20; index += 1) {
			try { sender.send({ type: 'signal', payload: 'x'.repeat(60_000) }); } catch { break; }
		}
		sender.send({ type: 'dependency', path: '/cannot-fit.ts' });
		expect(sender.stats().queuedBytes).toBeLessThanOrEqual(ipcQueueLimits.bytes);
		expect(sender.stats().queuedMessages).toBeLessThanOrEqual(ipcQueueLimits.messages);
		sender.disconnect();
	});

	test('bounds the lifetime of a stalled sender and releases timers and drain listeners', async () => {
		vi.useFakeTimers();
		const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
		const socket = new EventEmitter() as net.Socket;
		socket.write = vi.fn(() => false) as typeof socket.write;
		socket.ref = vi.fn(() => socket);
		socket.unref = vi.fn(() => socket);
		socket.destroy = vi.fn(() => socket);
		const sender = createIpcSender();
		try {
			sender.connect(socket);
			sender.send({ type: 'dependency', path: '/stalled.ts' });
			expect(socket.ref).toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(5000);
			expect(warning).toHaveBeenCalledWith(expect.stringContaining('timed out'), { code: 'TSNODE_IPC_TIMEOUT' });
			expect(socket.destroy).toHaveBeenCalledOnce();
			expect(sender.stats()).toMatchObject({ queuedBytes: 0, queuedMessages: 0, closed: true });
			expect(socket.listenerCount('drain')).toBe(0);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			sender.disconnect();
			warning.mockRestore();
			vi.useRealTimers();
		}
	});

	test('connects and sends queued messages from a child process', async () => {
		const pipePath = getPipePath(process.pid);
		server = await createIpcServer(pipePath);
		const messages: unknown[] = [];
		server.on('data', (message) => messages.push(message));

		const childProcess = runClient(`
			const { parent, connectingToServer } = await import(${Json.serialize(clientPath)});
			parent.send?.({ type: 'dependency', path: '/real/child.ts' });
			await connectingToServer;
		`, { TSNODE_IPC: '1', TSNODE_DEPENDENCY_REPORTING: '1' });
		const child = collect(childProcess);

		expect(await child.exited).toBe(0);
		await expect.poll(() => messages).toEqual([{ type: 'dependency', path: '/real/child.ts' }]);
		expect(child.stderr()).toBe('');
	});

	test('resolves without a sender when the IPC pipe is missing', async () => {
		const childProcess = runClient(`
			const { parent, connectingToServer } = await import(${Json.serialize(clientPath)});
			await connectingToServer;
			console.log(parent.send === undefined ? 'disconnected' : 'connected');
		`, { TSNODE_IPC: '1', TSNODE_DEPENDENCY_REPORTING: '1' });
		const child = collect(childProcess);

		expect(await child.exited).toBe(0);
		expect(child.stdout().trim()).toBe('disconnected');
		expect(child.stderr()).toBe('');
	});

	test('observes the client connection closing after the child exits', async () => {
		const pipePath = getPipePath(process.pid);
		server = await createIpcServer(pipePath);
		const connectionClosed = new Promise<void>((resolve) => server!.once('connection', socket => socket.once('close', () => resolve())));

		const childProcess = runClient(`
			const { connectingToServer } = await import(${Json.serialize(clientPath)});
			await connectingToServer;
		`, { TSNODE_IPC: '1' });
		const child = collect(childProcess);

		expect(await child.exited).toBe(0);
		await connectionClosed;
		expect(child.stderr()).toBe('');
	});
});