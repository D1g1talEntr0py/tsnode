import { enableCompileCache } from 'node:module';
import { constants as osConstants } from 'node:os';
import { isMainThread } from 'node:worker_threads';
import type { ProcessEventMap } from 'node:process';

type BaseEventListener = () => void;
type SignalListener<S extends NodeJS.Signals = NodeJS.Signals> = (signal: ProcessEventMap[S][0]) => void;

if (typeof enableCompileCache === 'function' && process.env['NODE_DISABLE_COMPILE_CACHE'] !== '1') {
	try { enableCompileCache() } catch { /* ignored */ }
}

const bindHiddenSignalsHandler = (signals: NodeJS.Signals[], handler: SignalListener) => {
	type RelaySignals = typeof signals[number];

	const hiddenHandlers = new Map<RelaySignals, SignalListener<RelaySignals>>();
	for (const signal of signals) {
		const hiddenHandler = (receivedSignal: NodeJS.Signals) => {
			handler(receivedSignal);

			// Since we're setting a custom signal handler, we need to emulate the default behavior when there are no other handlers set
			if (process.listenerCount(signal) === 0) { process.exit(128 + osConstants.signals[signal]) }
		};

		process.on(signal, hiddenHandler);
		hiddenHandlers.set(signal, hiddenHandler);
	}

	// Hide relaySignal from process.listeners() and process.listenerCount()
	const { listenerCount, listeners } = process;

	/**
	 * Overrides process.listenerCount() to exclude the hidden signal handlers from the count.
	 * This ensures that the hidden signal handlers do not interfere with the default behavior of Node.js when there are no other listeners for a signal.
	 * @param eventName The name of the event to count listeners for.
	 * @returns The number of listeners for the specified event, excluding the hidden signal handlers.
	 */
	process.listenerCount = function(eventName: RelaySignals) {
		let count = Reflect.apply(listenerCount, this, [ eventName ]);
		if (signals.includes(eventName)) { count -= 1 }

		return count;
	};

	/**
	 * Overrides process.listeners() to exclude the hidden signal handlers from the returned array of listeners.
	 * This ensures that the hidden signal handlers do not appear in the list of listeners for a signal.
	 * @param eventName The name of the event to retrieve listeners for.
	 * @returns An array of listeners for the specified event, excluding the hidden signal handlers.
	 */
	process.listeners = function(eventName: RelaySignals) {
		const result: BaseEventListener[] = Reflect.apply(listeners, this, [ eventName ]);

		return signals.includes(eventName) ? result.filter((listener) => listener !== hiddenHandlers.get(eventName)) : result;
	};
};

await import('./suppress-warnings');
const { connectingToServer } = await import('./utils/ipc/client');

// Worker threads inherit preloads; signal relay only belongs in the CLI child main thread.
if (isMainThread) {
	void (async () => {
		if (process.env['TSNODE_SIGNAL_RELAY'] === '0') { return }

		const sendToParent = await connectingToServer;

		if (sendToParent) {
			bindHiddenSignalsHandler([ 'SIGINT', 'SIGTERM' ], (signal: NodeJS.Signals) => sendToParent({ type: 'signal', signal }));
		}
	})();
}