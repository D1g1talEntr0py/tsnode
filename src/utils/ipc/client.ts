import { getPipePath } from './get-pipe-path';
import type { Parent, SendToParent } from '../../types';

export type { Parent, SendToParent } from '../../types';

/**
 * Whether this process should connect to the parent's IPC socket at all.
 * Set by the parent whenever it needs the socket, including for signal relay.
 */
const ipcEnabled = process.env['TSNODE_IPC'] === '1';

/**
 * Whether to report imported modules back to the parent. Only watch mode
 * consumes these, and they are deliberately separate from `TSNODE_IPC`:
 * enabling the socket for signal relay must not switch on per-module
 * dependency traffic for every ordinary run.
 */
const dependencyReportingEnabled = process.env['TSNODE_DEPENDENCY_REPORTING'] === '1';

let queuedMessages: Parameters<SendToParent>[0][] = [];
const queueMessage: SendToParent = (data) => {
	queuedMessages.push(data);
};

// `node:net` costs ~1ms to initialize and is only reachable when the parent enabled IPC, so it stays off the loader startup path.
const connectToServer = async (): Promise<SendToParent | undefined> => {
	const { default: net } = await import('node:net');

	return new Promise<SendToParent | undefined>((resolve) => {
		const socket = net.createConnection(getPipePath(process.ppid), () => {
			resolve((data) => {
				const messageBuffer = Buffer.from(JSON.stringify(data));
				const lengthBuffer = Buffer.alloc(4);
				lengthBuffer.writeInt32BE(messageBuffer.length, 0);
				socket.write(Buffer.concat([ lengthBuffer, messageBuffer ]));
			});
		});

		/**
		 * Ignore error when:
		 * - Called as a loader and there is no server
		 * - Nested process when using --test and the ppid is incorrect
		 */
		socket.on('error', () => resolve(undefined));

		// Prevent Node from waiting for this socket to close before exiting
		socket.unref();
	});
};

export const parent = {
	send: dependencyReportingEnabled ? queueMessage : undefined
} satisfies Parent;

export const connectingToServer = (ipcEnabled && process.env['TSNODE_SIGNAL_RELAY'] !== '0' ? connectToServer() : Promise.resolve<undefined>(undefined));

connectingToServer.then((send) => {
	if (send && dependencyReportingEnabled) {
		for (const message of queuedMessages) { send(message) }
	}

	queuedMessages = [];
	parent.send = dependencyReportingEnabled ? send : undefined;
},
() => {
	queuedMessages = [];
	parent.send = undefined;
});