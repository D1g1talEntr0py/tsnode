import { writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setColorEnabled, bgBlue, bgGray } from './ansi';

export const debugEnabled = Number(process.env['TSNODE_DEBUG']);

// Force colors in debug mode
if (debugEnabled) { setColorEnabled(true) }

/**
 * Loaded on demand. `node:util` costs ~3ms to initialize and this module sits in
 * the loader graph, so importing it eagerly taxed every run to support output
 * that is only produced when TSNODE_DEBUG is set.
 */
let inspect: typeof import('node:util').inspect | undefined;

const loadInspect = () => {
	inspect ??= createRequire(import.meta.url)('node:util').inspect as typeof import('node:util').inspect;

	return inspect;
};

const createLog = (name: string) => (level: number, ...args: any[]) => {
	if (!debugEnabled || level > debugEnabled) { return }

	const inspectValue = loadInspect();
	const logMessage = args.map(argumentElement => typeof argumentElement === 'string' ? argumentElement : inspectValue(argumentElement, { colors: true })).join(' ');

	writeSync(1, `${`${bgGray(` tsnode P${process.pid} `)} ${name}`} ${logMessage}\n`);
};

export const logEsm = createLog(bgBlue(' ESM '));