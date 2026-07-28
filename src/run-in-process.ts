import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { normalizeFileUrlPath } from './utils/path-utils';

/**
 * Runs the entry in the current process instead of forking a child.
 *
 * The CLI normally spawns `node --import loader.js <entry>`, which costs a full
 * second Node bootstrap (~23ms, roughly half of CLI startup on small inputs).
 * Hooks are registered with the *synchronous* `module.registerHooks`, so there
 * is no async-preload ordering requirement forcing a separate process.
 *
 * Only reached when the CLI has determined nothing requires a real child
 * process (see `canRunInProcess` in cli.ts).
 * @param argv Entry path followed by the arguments intended for it.
 */
export const runInProcess = async (argv: string[], resolvedEntrypointPath?: string) => {
	const [ entry, ...scriptArgv ] = argv;
	const argvEntryPath = path.resolve(normalizeFileUrlPath(entry));

	// Present the argv shape the forked child would have had: the tsnode flags
	// are already stripped, and argv[1] is the resolved entry.
	process.argv = [ process.argv[0], argvEntryPath, ...scriptArgv ];

	await import('./suppress-warnings');

	(await import('./api/index')).register();

	await import(pathToFileURL(resolvedEntrypointPath ?? argvEntryPath).href);
};
