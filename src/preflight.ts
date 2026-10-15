import { enableCompileCache } from 'node:module';
import { constants as osConstants } from 'node:os';
import { isMainThread } from 'node:worker_threads';
import type { ProcessEventMap } from 'node:process';

type SignalListener<S extends NodeJS.Signals = NodeJS.Signals> = (signal: ProcessEventMap[S][0]) => void;

if (process.env['NODE_DISABLE_COMPILE_CACHE'] !== '1') {
	try { enableCompileCache() } catch { /* ignored */ }
}

/**
 * Binds a hidden signal handler to the specified signals.
 * @param signals The signals to bind the handler to.
 * @param handler The signal handler to invoke.
 */
const bindHiddenSignalsHandler = (signals: NodeJS.Signals[], handler: SignalListener) => {
	for (const signal of signals) {
		const hiddenHandler = (receivedSignal: NodeJS.Signals) => {
			handler(receivedSignal);

			// Since we're setting a custom signal handler, we need to emulate the default behavior when there are no other handlers set
			if (!process.listeners(signal).some((listener) => listener !== hiddenHandler)) { process.exit(128 + osConstants.signals[signal]) }
		};

		process.on(signal, hiddenHandler);
	}
};

// enableCompileCache must run before importing any modules that could be compiled
const { connectingToServer } = await import('./utils/ipc/client');

// Worker threads inherit preloads; signal relay only belongs in the CLI child main thread.
if (isMainThread) {
	void (async () => {
		if (process.env['TSNODE_SIGNAL_RELAY'] === '0') { return }

		const sendToParent = await connectingToServer;

		if (sendToParent !== undefined) {
			bindHiddenSignalsHandler([ 'SIGINT', 'SIGTERM' ], (signal: NodeJS.Signals) => sendToParent({ type: 'signal', signal }));
		}
	})();
}