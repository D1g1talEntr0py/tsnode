import { writeSync } from 'node:fs';
import { setColorEnabled, bgBlue, bgGray } from './ansi';

export const debugEnabled = Number(process.env['TSNODE_DEBUG']);

// Force colors in debug mode
if (debugEnabled) { setColorEnabled(true) }

export const formatDebugValue = (value: unknown): string => {
	if (typeof value === 'string') { return value }

	if (value instanceof Error) {
		return JSON.stringify({ name: value.name, message: value.message, stack: value.stack }, null, 2);
	}

	const seen = new WeakSet<object>();

	const replacer = (_key: string, currentValue: unknown): unknown => {
		if (typeof currentValue === 'bigint') { return `${currentValue.toString()}n` }
		if (typeof currentValue === 'function') { return `[Function ${currentValue.name || 'anonymous'}]` }
		if (typeof currentValue === 'symbol') { return currentValue.toString() }

		if (currentValue && typeof currentValue === 'object') {
			if (seen.has(currentValue)) { return '[Circular]' }
			seen.add(currentValue);
		}

		return currentValue;
	};

	try {
		const serialized = JSON.stringify(value, replacer, 2);

		if (serialized !== undefined) { return serialized }
	} catch { /* ignore */ }

	return String(value);
};

const createLog = (name: string) => (level: number, ...args: unknown[]) => {
	if (!debugEnabled || level > debugEnabled) { return }

	const logMessage = args.map(formatDebugValue).join(' ');

	writeSync(1, `${`${bgGray(` tsnode P${process.pid} `)} ${name}`} ${logMessage}\n`);
};

export const logEsm = createLog(bgBlue(' ESM '));