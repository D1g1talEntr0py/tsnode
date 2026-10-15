import { getPipePath } from './get-pipe-path';
import { noop } from '../constants';
import type { Parent, SendToParent } from '../../types';
import type { Socket } from 'node:net';
import { Json } from '../json';

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

export const ipcQueueLimits = { bytes: 1024 * 1024, messages: 1024, frameBytes: 64 * 1024, controls: 32 } as const;

export const createIpcSender = (onDisconnect: () => void = noop) => {
	const dependencies = new Map<string, Buffer>();
	const controls: Buffer[] = [];
	let queuedBytes = 0;
	let socket: Socket | undefined;
	let blocked = false;
	let closed = false;
	let overflow = false;
	let overflowNotice: Buffer | undefined;
	let inFlight = 0;
	let stallTimer: NodeJS.Timeout | undefined;
	const frame = (data: Record<string, unknown>) => {
		const serialized = Json.serialize(data);
		if (serialized === undefined) { throw new TypeError('IPC message must serialize to JSON') }
		const message = Buffer.from(serialized);
		const prefix = Buffer.allocUnsafe(4);
		prefix.writeInt32BE(message.length);
		return Buffer.concat([ prefix, message ]);
	};
	const overflowFrame = frame({ type: 'dependency-overflow', reason: 'IPC queue capacity exceeded' });
	const disconnect = () => {
		if (closed) { return }
		closed = true;
		dependencies.clear();
		controls.length = 0;
		overflowNotice = undefined;
		queuedBytes = 0;
		clearTimeout(stallTimer);
		socket?.removeListener('drain', onDrain);
		socket?.destroy();
		onDisconnect();
	};
	const updateLiveness = () => {
		if (!socket || closed) { return }
		if (queuedBytes > 0 || inFlight > 0 || blocked) {
			socket.ref();
			stallTimer ??= setTimeout(() => {
				process.emitWarning('IPC delivery timed out; watch dependency coverage may be incomplete', { code: 'TSNODE_IPC_TIMEOUT' });
				disconnect();
			}, 5000);
		} else {
			clearTimeout(stallTimer);
			stallTimer = undefined;
			socket.unref();
		}
	};
	const flush = () => {
		updateLiveness();
		if (!socket || blocked || closed) { return }
		while (!blocked && !closed) {
			let next = controls.shift();
			if (!next && overflowNotice) {
				next = overflowNotice;
				overflowNotice = undefined;
			}
			if (!next) {
				const entry = dependencies.entries().next().value;
				if (entry) {
					dependencies.delete(entry[0]);
					next = entry[1];
				}
			}
			if (!next) { updateLiveness(); return }
			queuedBytes -= next.length;
			inFlight += 1;
			try {
				blocked = !socket.write(next, (error) => {
					inFlight -= 1;
					clearTimeout(stallTimer);
					stallTimer = undefined;
					if (error) { disconnect() } else { updateLiveness() }
				});
			} catch { disconnect() }
		}
		updateLiveness();
	};
	const onDrain = () => { blocked = false; flush() };
	const reportOverflow = () => {
		if (overflow) { return }
		overflow = true;
		for (const dependency of dependencies.values()) { queuedBytes -= dependency.length }
		dependencies.clear();
		overflowNotice = overflowFrame;
		queuedBytes += overflowNotice.length;
		flush();
	};
	const send: SendToParent = (data) => {
		if (closed) { return }
		const dependencyPath = data['type'] === 'dependency' && typeof data['path'] === 'string' ? data['path'] : undefined;
		if (dependencyPath && (overflow || dependencies.has(dependencyPath))) { return }
		const message = frame(data);
		if (message.length > ipcQueueLimits.frameBytes || (dependencyPath ?
			dependencies.size + controls.length >= ipcQueueLimits.messages - ipcQueueLimits.controls || queuedBytes + message.length > ipcQueueLimits.bytes - ipcQueueLimits.frameBytes :
			controls.length >= ipcQueueLimits.controls || queuedBytes + message.length > ipcQueueLimits.bytes - overflowFrame.length)) {
			if (dependencyPath) { reportOverflow(); return }
			throw new Error('IPC control queue capacity exceeded');
		}
		queuedBytes += message.length;
		if (dependencyPath) { dependencies.set(dependencyPath, message) } else { controls.push(message) }
		flush();
	};
	const connect = (connection: Socket) => {
		if (closed) { connection.destroy(); return }
		socket = connection;
		connection.on('drain', onDrain);
		connection.once('close', disconnect);
		connection.on('error', disconnect);
		flush();
	};
	const stats = () => ({ queuedBytes, queuedMessages: dependencies.size + controls.length + Number(Boolean(overflowNotice)), closed });
	return { send, connect, disconnect, stats };
};

let connected = false;
const sender = ipcEnabled ? createIpcSender(() => {
	parent.send = undefined;
	if (connected && dependencyReportingEnabled) {
		process.emitWarning('IPC disconnected; watch dependency reporting is unavailable', { code: 'TSNODE_IPC_DISCONNECTED' });
	}
}) : undefined;

// `node:net` costs ~1ms to initialize and is only reachable when the parent enabled IPC, so it stays off the loader startup path.
const connectToServer = async (): Promise<SendToParent | undefined> => {
	if (!sender) { return undefined }
	const { default: net } = await import('node:net');

	return new Promise<SendToParent | undefined>((resolve) => {
		const socket = net.createConnection(getPipePath(process.ppid), () => {
			connected = true;
			sender.connect(socket);
			resolve(sender.stats().closed ? undefined : sender.send);
		});

		/**
		 * Ignore error when:
		 * - Called as a loader and there is no server
		 * - Nested process when using --test and the ppid is incorrect
		 */
		socket.on('error', () => { sender.disconnect(); resolve(undefined) });
		socket.once('close', () => { sender.disconnect(); resolve(undefined) });

		// Prevent Node from waiting for this socket to close before exiting
		socket.unref();
	});
};

export const parent = {
	send: dependencyReportingEnabled ? sender?.send : undefined
} satisfies Parent;

export const connectingToServer = (ipcEnabled && (dependencyReportingEnabled || process.env['TSNODE_SIGNAL_RELAY'] !== '0') ? connectToServer() : Promise.resolve<undefined>(undefined));

connectingToServer.then((send) => {
	if (!send) { sender?.disconnect() }
	parent.send = dependencyReportingEnabled && sender && !sender.stats().closed ? send : undefined;
},
() => {
	sender?.disconnect();
});