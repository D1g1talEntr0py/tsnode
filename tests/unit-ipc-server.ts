import net from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createIpcServer } from '../src/utils/ipc/server';
import { tmpdir } from '../src/utils/temporary-directory';

const pipePathForTest = () => {
	const pipeName = `ipc-${randomUUID()}.pipe`;
	return process.platform === 'win32' ? `\\?\pipe\${path.join(tmpdir, pipeName)}` : path.join(tmpdir, pipeName);
};

const frame = (message: string, length = Buffer.byteLength(message)) => {
	const prefix = Buffer.alloc(4);
	prefix.writeInt32BE(length);
	return Buffer.concat([ prefix, Buffer.from(message) ]);
};

describe('IPC server', () => {
	let server: net.Server | undefined;

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
	});

	test('reassembles frames and ignores malformed JSON without closing the connection', async () => {
		const testPipePath = pipePathForTest();
		server = await createIpcServer(testPipePath);
		const messages: unknown[] = [];
		server.on('data', (message) => messages.push(message));

		const socket = net.createConnection(testPipePath);
		await new Promise<void>((resolve) => socket.once('connect', resolve));
		socket.write(frame('{malformed}'));
		const validFrame = frame('{"type":"dependency","path":"/tmp/example.ts"}');
		socket.write(validFrame.subarray(0, 3));
		socket.write(validFrame.subarray(3));

		await vi.waitFor(() => expect(messages).toEqual([{ type: 'dependency', path: '/tmp/example.ts' }]));
		socket.destroy();
	});

	test('reassembles fragmented frames without concatenating the whole buffer each time', async () => {
		const testPipePath = pipePathForTest();
		server = await createIpcServer(testPipePath);
		const messages: unknown[] = [];
		server.on('data', (message) => messages.push(message));

		const socket = net.createConnection(testPipePath);
		await new Promise<void>((resolve) => socket.once('connect', resolve));

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

		await vi.waitFor(() => expect(messages).toEqual([{ type: 'dependency', path: '/tmp/example.ts' }]));
		socket.destroy();
	});

	test.each([
		['negative', -1],
		['oversized', 10 * 1024 * 1024 + 1],
	])('closes the connection for a %s length prefix', async (_name, length) => {
		const testPipePath = pipePathForTest();
		server = await createIpcServer(testPipePath);
		const socket = net.createConnection(testPipePath);
		await new Promise<void>((resolve) => socket.once('connect', resolve));

		const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
		socket.write(frame('', length));
		await closed;
		expect(socket.destroyed).toBe(true);
	});
});