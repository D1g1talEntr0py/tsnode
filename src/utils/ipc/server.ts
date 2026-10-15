import { createServer, type Server, type Socket } from 'node:net';
import { rmSync } from 'node:fs';
import { ensurePrivateDirectory } from '../temporary-directory';
import { isWindows, getPipePath } from './get-pipe-path';
import { Json } from '../json';

type OnMessage = (message: Buffer) => void;

const maxMessageLength = 10 * 1024 * 1024;

/**
 * Buffers incoming data and emits complete messages to the provided callback.
 * Each message is prefixed with a 4-byte big-endian integer indicating the length of the message.
 * @param onMessage Callback invoked with each complete message.
 * @param onInvalidLength Callback invoked when an invalid message length is encountered.
 */
export const bufferData = (onMessage: OnMessage, onInvalidLength: () => void) => {
	const chunks: Buffer[] = [];
	let totalLength = 0;

	/**
	 * Consume the specified number of bytes from the buffered chunks.
	 * @param length The number of bytes to consume from the buffer.
	 */
	const consume = (length: number) => {
		let remaining = length;
		while (remaining > 0) {
			const chunk = chunks[0];
			if (!chunk) { break }

			if (chunk.length <= remaining) {
				chunks.shift();
				remaining -= chunk.length;
				totalLength -= chunk.length;
			} else {
				chunks[0] = chunk.subarray(remaining);
				totalLength -= remaining;
				remaining = 0;
			}
		}
	};

	/**
	 * Read the length of the next message from the buffered chunks.
	 * This function assumes that there are at least 4 bytes available in the buffer.
	 * @returns The length of the next message as a 32-bit big-endian integer.
	 */
	const readLength = () => {
		const firstChunk = chunks[0];
		if (firstChunk && firstChunk.length >= 4) { return firstChunk.readInt32BE(0) }

		const prefix = Buffer.alloc(4);
		let written = 0;
		for (const chunk of chunks) {
			const bytesToCopy = Math.min(4 - written, chunk.length);
			chunk.copy(prefix, written, 0, bytesToCopy);
			written += bytesToCopy;
			if (written === 4) { break }
		}

		return prefix.readInt32BE(0);
	};

	return (data: Buffer) => {
		chunks.push(data);
		totalLength += data.length;

		while (totalLength >= 4) {
			const messageLength = readLength();
			if (messageLength < 0 || messageLength > maxMessageLength) {
				onInvalidLength();
				return;
			}

			if (totalLength < 4 + messageLength) { break }

			consume(4);
			const firstChunk = chunks[0];
			if (firstChunk && firstChunk.length >= messageLength) {
				const message = firstChunk.subarray(0, messageLength);
				consume(messageLength);
				onMessage(message);
				continue;
			}

			const message = Buffer.allocUnsafe(messageLength);
			let offset = 0;
			while (offset < messageLength) {
				const chunk = chunks[0];
				if (!chunk) { break }

				const bytesToCopy = Math.min(chunk.length, messageLength - offset);
				chunk.copy(message, offset, 0, bytesToCopy);

				if (bytesToCopy === chunk.length) {
					chunks.shift();
					totalLength -= chunk.length;
				} else {
					chunks[0] = chunk.subarray(bytesToCopy);
					totalLength -= bytesToCopy;
				}
				offset += bytesToCopy;
			}
			onMessage(message);
		}
	};
};

const serverClosers = new WeakMap<Server, () => Promise<void>>();

export const closeIpcServer = (server: Server): Promise<void> => serverClosers.get(server)?.() ?? new Promise<void>((resolve) => server.close(() => resolve()));

export const createIpcServer = async (pipePath = getPipePath(process.pid)) => {
	const sockets = new Set<Socket>();
	let closing: Promise<void> | undefined;
	const server = createServer((socket) => {
		if (closing) { socket.destroy(); return }
		sockets.add(socket);
		socket.unref();
		socket.once('close', () => sockets.delete(socket));
		socket.on('error', () => socket.destroy());
		socket.on('data', bufferData((message: Buffer) => {
			try {
				const parsedMessage: unknown = Json.parse(message.toString());
				server.emit('data', parsedMessage);
			} catch { /* Ignore malformed frames and keep the connection available for later messages. */ }
		}, () => socket.destroy()));
	});

	// Sync: the child cannot be spawned until the socket is listening, so each
	// async fs round trip here is pure added latency on the CLI critical path.
	ensurePrivateDirectory();

	/**
	 * Fix #457 (https://github.com/privatenumber/tsx/issues/457)
	 *
	 * Avoid the error "EADDRINUSE: address already in use"
	 *
	 * If the pipe file already exists, it means that the previous process has been closed abnormally.
	 *
	 * We can safely delete the pipe file, the previous process must has been closed,
	 * as pid is unique at the same.
	 */
	rmSync(pipePath, { force: true });

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(pipePath, () => {
			server.removeListener('error', reject);
			resolve();
		});
	});

	// Prevent Node from waiting for this socket to close before exiting
	server.unref();

	const onExit = () => {
		for (const socket of sockets) { socket.destroy() }

		/**
		 * Only clean on Unix
		 *
		 * https://nodejs.org/api/net.html#ipc-support:
		 * On Windows, the local domain is implemented using a named pipe.
		 * The path must refer to an entry in \\?\pipe\ or \\.\pipe\.
		 * Any characters are permitted, but the latter may do some processing
		 * of pipe names, such as resolving .. sequences. Despite how it might
		 * look, the pipe namespace is flat. Pipes will not persist. They are
		 * removed when the last reference to them is closed. Unlike Unix domain
		 * sockets, Windows will close and remove the pipe when the owning process exits.
		 */
		if (!isWindows) {
			try { rmSync(pipePath) } catch { /* ignore */ }
		}
	};
	process.on('exit', onExit);

	const originalClose = server.close.bind(server);
	const close = () => {
		if (!closing) {
			process.removeListener('exit', onExit);
			for (const socket of sockets) { socket.destroy() }
			closing = new Promise<void>((resolve) => originalClose(() => resolve()));
		}

		return closing;
	};
	serverClosers.set(server, close);
	server.close = (callback) => {
		void close().then(() => callback?.());
		return server;
	};

	return server;
};