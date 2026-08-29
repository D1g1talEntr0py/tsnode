import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createIpcServer } from '../src/utils/ipc/server';
import { getPipePath } from '../src/utils/ipc/get-pipe-path';
import { tmpdir } from '../src/utils/temporary-directory';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
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
	childProcess.stdout!.setEncoding('utf8');
	childProcess.stdout!.on('data', (chunk: string) => { stdout += chunk; });
	childProcess.stderr!.setEncoding('utf8');
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

	test('connects and sends queued messages from a child process', async () => {
		const pipePath = getPipePath(process.pid);
		server = await createIpcServer(pipePath);
		const messages: unknown[] = [];
		server.on('data', (message) => messages.push(message));

		const childProcess = runClient(`
			const { parent, connectingToServer } = await import(${JSON.stringify(clientPath)});
			await connectingToServer;
			parent.send?.({ type: 'dependency', path: '/real/child.ts' });
		`, { TSNODE_IPC: '1', TSNODE_DEPENDENCY_REPORTING: '1' });
		const child = collect(childProcess);

		expect(await child.exited).toBe(0);
		await expect.poll(() => messages).toEqual([{ type: 'dependency', path: '/real/child.ts' }]);
		expect(child.stderr()).toBe('');
	});

	test('resolves without a sender when the IPC pipe is missing', async () => {
		const childProcess = runClient(`
			const { parent, connectingToServer } = await import(${JSON.stringify(clientPath)});
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
			const { connectingToServer } = await import(${JSON.stringify(clientPath)});
			await connectingToServer;
		`, { TSNODE_IPC: '1' });
		const child = collect(childProcess);

		expect(await child.exited).toBe(0);
		await connectionClosed;
		expect(child.stderr()).toBe('');
	});
});