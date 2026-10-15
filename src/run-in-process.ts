import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { isFilePath, normalizeFileUrlPath } from './utils/path-utils';
import worker_threads from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';

/**
 * Canonicalizes an import specifier to a file URL if it is a file path or already a file URL.
 * @param specifier The import specifier to canonicalize.
 * @returns The canonicalized import specifier.
 */
const canonicalizeImportSpecifier = (specifier: string) => {
	return isFilePath(specifier) || specifier.startsWith('file://') ? pathToFileURL(resolve(normalizeFileUrlPath(specifier))).href : specifier;
};

/**
 * `child_process.fork()` defaults its `execArgv` option to a live read of
 * `process.execArgv`, so appending `--import loader.js` here is enough for
 * default (execArgv-less) `fork()` calls made by the entry to inherit tsnode's
 * hooks the same way they would under `--import`/the forked CLI path.
 *
 * `worker_threads.Worker` does NOT behave the same way: empirically, a default
 * `new Worker(...)` (no explicit `execArgv`) does not pick up entries appended
 * to `process.execArgv` after process startup, only what was present at boot.
 * So `Worker` is separately patched below to explicitly forward the (now
 * up-to-date) `process.execArgv` when the caller didn't provide their own.
 */
export const ensureLoaderInheritedByChildren = () => {
	const loaderImportUrl = new URL('./loader.js', import.meta.url).href;
	const canonicalLoaderImportUrl = canonicalizeImportSpecifier(loaderImportUrl);
	const alreadyPresent = process.execArgv.some((flag, index) => {
		const importSpecifier = flag === '--import' ? process.execArgv[index + 1] : flag.startsWith('--import=') ? flag.slice('--import='.length) : undefined;

		return importSpecifier !== undefined && canonicalizeImportSpecifier(importSpecifier) === canonicalLoaderImportUrl;
	});

	if (!alreadyPresent) { process.execArgv.push('--import', loaderImportUrl) }

	const OriginalWorker = worker_threads.Worker;
	if (!('tsnodePatched' in OriginalWorker)) {
		/**
		 * `worker_threads.Worker` does NOT behave the same way as `child_process.fork()`: empirically, a default `new Worker(...)` (no explicit `execArgv`)
		 * does not pick up entries appended to `process.execArgv` after process startup, only what was present at boot. So `Worker` is separately patched
		 * below to explicitly forward the (now up-to-date) `process.execArgv` when the caller didn't provide their own.
		 */
		class TsnodeWorker extends OriginalWorker {
			constructor(filename: string | URL, options?: WorkerOptions) {
				super(filename, options?.execArgv !== undefined ? options : { ...options, execArgv: [ ...process.execArgv ] });
			}
		}

		worker_threads.Worker = Object.defineProperty(TsnodeWorker, 'tsnodePatched', { value: true });
		syncBuiltinESMExports();
	}
};

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
 * @param resolvedEntrypointPath The resolved entrypoint path, if already known. If not provided, it will be resolved from the first argument in `argv`.
 * @returns A promise that resolves when the entry has finished running.
 */
export const runInProcess = async (argv: string[], resolvedEntrypointPath?: string) => {
	const [ entry, ...scriptArgv ] = argv;

	if (entry === undefined) { throw new TypeError('Missing entry path') }

	const argvEntryPath = resolve(normalizeFileUrlPath(entry));
	const executablePath = process.argv[0];

	if (executablePath === undefined) { throw new TypeError('Missing executable path') }

	// Present the argv shape the forked child would have had: the tsnode flags are already stripped, and argv[1] is the resolved entry.
	process.argv = [ executablePath, argvEntryPath, ...scriptArgv ];

	ensureLoaderInheritedByChildren();

	(await import('./api/index')).register();

	await import(pathToFileURL(resolvedEntrypointPath ?? argvEntryPath).href);
};
