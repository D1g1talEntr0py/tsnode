import net from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chmodSync, existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { closeIpcServer, createIpcServer } from '../src/utils/ipc/server';
import { assertPrivateDirectory, ensurePrivateDirectory, tmpdir } from '../src/utils/temporary-directory';

const pipePathForTest = () => {
	const pipeName = `ipc-${randomUUID()}.pipe`;
	return process.platform === 'win32' ? `\\?\pipe\${path.join(tmpdir, pipeName)}` : path.join(tmpdir, pipeName);
};

const frame = (message: string, length = Buffer.byteLength(message)) => {
	const prefix = Buffer.alloc(4);
	prefix.writeInt32BE(length);
	return Buffer.concat([ prefix, Buffer.from(message) ]);
};

const connect = (pipePath: string) => new Promise<net.Socket>((resolve, reject) => {
	const socket = net.createConnection(pipePath);
	const onError = (error: Error) => {
		socket.removeListener('connect', onConnect);
		reject(error);
	};
	const onConnect = () => {
		socket.removeListener('error', onError);
		resolve(socket);
	};
	socket.once('error', onError);
	socket.once('connect', onConnect);
});

const nextMessage = (ipcServer: net.Server) => new Promise<unknown>((resolve, reject) => {
	const timeout = setTimeout(() => {
		ipcServer.removeListener('data', onData);
		reject(new Error('Timed out waiting for IPC message'));
	}, 1_000);
	const onData = (message: unknown) => {
		clearTimeout(timeout);
		resolve(message);
	};
	ipcServer.once('data', onData);
});

const closeSocket = (socket: net.Socket) => new Promise<void>((resolve) => {
	if (socket.destroyed) {
		resolve();
		return;
	}
	socket.once('close', () => resolve());
	socket.destroy();
});

describe('IPC server', () => {
	let server: net.Server | undefined;

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
	});

	test('normal close restores exit listener baseline and closes idle connections', async () => {
		const baseline = process.listenerCount('exit');
		for (let iteration = 0; iteration < 3; iteration += 1) {
			const pipePath = pipePathForTest();
			server = await createIpcServer(pipePath);
			const socket = await connect(pipePath);
			const closed = new Promise<void>(resolve => socket.once('close', resolve));
			await new Promise<void>(resolve => server!.close(() => resolve()));
			await Promise.all([ closeIpcServer(server), closeIpcServer(server) ]);
			await closed;
			expect(socket.destroyed).toBe(true);
			expect(process.listenerCount('exit')).toBe(baseline);
			if (process.platform !== 'win32') { expect(existsSync(pipePath)).toBe(false); }
			server = undefined;
		}
	});

	test('rejects a temporary directory owned by another user', () => {
		const directoryStats = { isDirectory: () => true, isSymbolicLink: () => false, uid: 1001 };
		expect(() => assertPrivateDirectory('/tmp/tsnode-owner', directoryStats, 1000)).toThrow('Unsafe temporary directory');
	});

	test.skipIf(process.platform === 'win32')('secures owned directories and rejects symlinks', () => {
		const root = mkdtempSync(path.join(osTmpdir(), 'tsnode-private-'));
		try {
			chmodSync(root, 0o777);
			ensurePrivateDirectory(root);
			expect(lstatSync(root).mode & 0o777).toBe(0o700);
			const link = path.join(root, 'link');
			symlinkSync(root, link);
			expect(() => ensurePrivateDirectory(link)).toThrow('Unsafe temporary directory');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('reassembles frames and ignores malformed JSON without closing the connection', async () => {
		const testPipePath = pipePathForTest();
		server = await createIpcServer(testPipePath);
		const messages: unknown[] = [];
		server.on('data', (message) => messages.push(message));

		const socket = await connect(testPipePath);
		const message = nextMessage(server);
		socket.write(frame('{malformed}'));
		const validFrame = frame('{"type":"dependency","path":"/tmp/example.ts"}');
		socket.write(validFrame.subarray(0, 3));
		socket.write(validFrame.subarray(3));

		await expect(message).resolves.toEqual({ type: 'dependency', path: '/tmp/example.ts' });
		expect(messages).toEqual([{ type: 'dependency', path: '/tmp/example.ts' }]);
		await closeSocket(socket);
	});

	test('reassembles fragmented frames without concatenating the whole buffer each time', async () => {
		const testPipePath = pipePathForTest();
		server = await createIpcServer(testPipePath);
		const messages: unknown[] = [];
		server.on('data', (message) => messages.push(message));

		const socket = await connect(testPipePath);
		const message = nextMessage(server);

		const validFrame = frame('{"type":"dependency","path":"/tmp/example.ts"}');
		for (const chunk of [
			validFrame.subarray(0, 2),
			validFrame.subarray(2, 4),
			validFrame.subarray(4, 6),
			validFrame.subarray(6, 12),
			validFrame.subarray(12),
		]) {
			socket.write(chunk);
		}

		await expect(message).resolves.toEqual({ type: 'dependency', path: '/tmp/example.ts' });
		expect(messages).toEqual([{ type: 'dependency', path: '/tmp/example.ts' }]);
		await closeSocket(socket);
	});

	test.each([
		['negative', -1],
		['oversized', 10 * 1024 * 1024 + 1],
	])('closes the connection for a %s length prefix', async (_name, length) => {
		const testPipePath = pipePathForTest();
		server = await createIpcServer(testPipePath);
		const socket = await connect(testPipePath);

		const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
		socket.write(frame('', length));
		await closed;
		expect(socket.destroyed).toBe(true);
	});
});