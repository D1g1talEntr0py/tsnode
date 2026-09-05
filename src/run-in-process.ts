import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import worker_threads from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import { isFilePath, normalizeFileUrlPath } from './utils/path-utils';

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
const ensureLoaderInheritedByChildren = () => {
	const loaderImportUrl = new URL('./loader.js', import.meta.url).href;
	const canonicalizeImportSpecifier = (specifier: string) => isFilePath(specifier) || specifier.startsWith('file://') ? pathToFileURL(path.resolve(normalizeFileUrlPath(specifier))).href : specifier;
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
				super(filename, options?.execArgv ? options : { ...options, execArgv: [ ...process.execArgv ] });
			}
		}

		Object.defineProperty(TsnodeWorker, 'tsnodePatched', { value: true });
		worker_threads.Worker = TsnodeWorker;
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
	const argvEntryPath = path.resolve(normalizeFileUrlPath(entry));

	// Present the argv shape the forked child would have had: the tsnode flags
	// are already stripped, and argv[1] is the resolved entry.
	process.argv = [ process.argv[0], argvEntryPath, ...scriptArgv ];

	ensureLoaderInheritedByChildren();

	await import('./suppress-warnings');

	(await import('./api/index')).register();

	await import(pathToFileURL(resolvedEntrypointPath ?? argvEntryPath).href);
};
