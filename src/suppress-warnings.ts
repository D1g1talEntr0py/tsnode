import type { ProcessEventMap } from 'node:process';

const ignoreWarnings = new Set([
	// v18.0.0
	'Custom ESM Loaders is an experimental feature. This feature could change at any time',
	// Changed in Node v18.13.0 via https://github.com/nodejs/node/pull/45424
	'Custom ESM Loaders is an experimental feature and might change at any time',
	// For JSON modules via https://github.com/nodejs/node/pull/46901
	'Import assertions are not a stable feature of the JavaScript language. Avoid relying on their current behavior and syntax as those might change in a future version of Node.js.',
	// Emitted once by module.stripTypeScriptTypes()
	'stripTypeScriptTypes is an experimental feature and might change at any time'
]);

const emit: typeof process.emit = process.emit;

/**
 * Suppresses warnings that are known to be emitted by Node.js when using ts-node.
 * This is a temporary measure until Node.js stabilizes these features.
 * @param event The event name.
 * @param args The event arguments.
 * @returns True if the event was handled, false otherwise.
 */
process.emit = function<E extends keyof ProcessEventMap>(event: E, ...args: ProcessEventMap[E]): boolean {
	if (event === 'warning') {
		const maybeWarning: unknown = args[0];
		if (maybeWarning instanceof Error && ignoreWarnings.has(maybeWarning.message)) { return true }
	}

	return !!Reflect.apply(emit, this, args);
};

export {};