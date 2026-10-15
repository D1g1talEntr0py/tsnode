import { writeSync } from 'node:fs';
import { Json } from './json';
import { setColorEnabled, bgBlue, bgGray } from './ansi';

const debugEnabled = Number(process.env['TSNODE_DEBUG']);

// Force colors in debug mode
if (debugEnabled) { setColorEnabled(true) }

const createReplacer = (() => {
	const seen = new WeakSet<object>();

	return (_key: string, currentValue: unknown) => {
		switch (typeof currentValue) {
			case 'bigint': return `${currentValue.toString()}n`;
			case 'function': return `[Function ${currentValue.name || 'anonymous'}]`;
			case 'symbol': return currentValue.toString();
		}

		if (currentValue != null && typeof currentValue === 'object') {
			if (seen.has(currentValue)) { return '[Circular]' }
			seen.add(currentValue);
		}

		return currentValue;
	};
});

const formatDebugValue = (value: unknown) => {
	if (typeof value === 'string') { return value }

	if (value instanceof Error) {
		return Json.serialize({ name: value.name, message: value.message, stack: value.stack, cause: value.cause }, null, 2);
	}

	try {
		const serialized = Json.serialize(value, createReplacer(), 2);

		if (serialized !== undefined) { return serialized }
	} catch { /* ignore */ }

	return String(value);
};

const createLog = (name: string) => (level: number, ...args: unknown[]) => {
	if (!debugEnabled || level > debugEnabled) { return }

	writeSync(1, `${`${bgGray(` tsnode P${process.pid} `)} ${name}`} ${args.map(formatDebugValue).join(' ')}\n`);
};

const logEsm = createLog(bgBlue(' ESM '));

export { debugEnabled, formatDebugValue, logEsm };