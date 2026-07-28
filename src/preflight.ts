import { enableCompileCache } from 'node:module';
import { constants as osConstants } from 'node:os';
import { isMainThread } from 'node:worker_threads';
import type { ProcessEventMap } from 'node:process';

type BaseEventListener = () => void;
type SignalListener<S extends NodeJS.Signals = NodeJS.Signals> = (signal: ProcessEventMap[S][0]) => void;

if (typeof enableCompileCache === 'function' && process.env['NODE_DISABLE_COMPILE_CACHE'] !== '1') {
	try { enableCompileCache() } catch {}
}

const bindHiddenSignalsHandler = (signals: NodeJS.Signals[], handler: SignalListener) => {
	type RelaySignals = typeof signals[number];

	const hiddenHandlers = new Map<RelaySignals, SignalListener<RelaySignals>>();
	for (const signal of signals) {
		const hiddenHandler = (receivedSignal: NodeJS.Signals) => {
			handler(receivedSignal);

			// Since we're setting a custom signal handler, we need to emulate the default behavior when there are no other handlers set
			if (process.listenerCount(signal) === 0) {
				process.exit(128 + osConstants.signals[signal]);
			}
		};

		process.on(signal, hiddenHandler);
		hiddenHandlers.set(signal, hiddenHandler);
	}

	// Hide relaySignal from process.listeners() and process.listenerCount()
	const { listenerCount, listeners } = process;

	process.listenerCount = function(eventName: RelaySignals) {
		let count = Reflect.apply(listenerCount, this, arguments);
		if (signals.includes(eventName)) { count -= 1 }

		return count;
	};

	process.listeners = function(eventName: RelaySignals) {
		const result: BaseEventListener[] = Reflect.apply(listeners, this, arguments);

		return signals.includes(eventName) ? result.filter(listener => listener !== hiddenHandlers.get(eventName)) : result;
	};
};

await import('./suppress-warnings');
const { connectingToServer } = await import('./utils/ipc/client');

// Worker threads inherit preloads; signal relay only belongs in the CLI child main thread.
if (isMainThread) {
	(async () => {
		if (process.env['TSNODE_SIGNAL_RELAY'] === '0') { return }

		const sendToParent = await connectingToServer;

		if (sendToParent) {
			bindHiddenSignalsHandler([ 'SIGINT', 'SIGTERM' ], (signal: NodeJS.Signals) => sendToParent({ type: 'signal', signal }));
		}
	})();
}