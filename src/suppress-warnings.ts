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

process.emit = function(event: string | symbol, ...args: any[]): boolean {
	return event === 'warning' && ignoreWarnings.has(args[0].message) ? true : Reflect.apply(emit, this, arguments);
};

export {};