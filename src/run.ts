import { inheritedExecArgv } from './remove-argv-flags';
import { spawn, type StdioOptions } from 'node:child_process';
import type { RunOptions } from './types';

/**
 * Determines whether the REPL should be patched based on the provided arguments.
 * @param argv The command-line arguments to check.
 * @returns `true` if the REPL should be patched, `false` otherwise.
 */
const shouldPatchRepl = (argv: string[]) => {
	for (const flag of argv) {
		if (flag !== '-i' && flag !== '--interactive') { return false }
	}

	return true;
};

/**
 * Spawns a new Node.js process with the given arguments and options.
 * @param argv The command-line arguments to pass to the Node.js process.
 * @param options Optional settings for running the process.
 * @returns The spawned child process instance.
 */
export const run = (argv: string[], options?: RunOptions) => {
	// [ stdin, stdout, stderr, ipc? ]
	const stdio: StdioOptions = [ 'inherit', 'inherit', 'inherit' ];
	const spawnEnv = { ...process.env };

	// If parent process spawns tsnode with ipc, spawn child with ipc
	if (process.send) { stdio.push('ipc') }

	// The preflight preload connects the socket; it is only worth loading when something on the other end will actually use it.
	const signalRelayEnabled = options?.signalRelay !== false;
	const needsIpcSocket = Boolean(options?.ipc) || signalRelayEnabled;

	if (options) {
		if (options.noCache) { spawnEnv['TSNODE_DISABLE_CACHE'] = '1' }

		if (!signalRelayEnabled) { spawnEnv['TSNODE_SIGNAL_RELAY'] = '0' }

		// Watch mode: report each loaded module back to the parent
		if (options.ipc) { spawnEnv['TSNODE_DEPENDENCY_REPORTING'] = '1' }

		if (options.tsconfigPath) { spawnEnv['TSNODE_TSCONFIG_PATH'] = options.tsconfigPath }
	}

	// Without this the child never connects, so the preflight's signal handlers were never bound and the relay silently did nothing.
	if (needsIpcSocket) { spawnEnv['TSNODE_IPC'] = '1' }

	const args = [
		...(needsIpcSocket ? [ '--import', new URL('./preflight.js', import.meta.url).toString() ] : []),
		...(shouldPatchRepl(argv) ? [ '--import', new URL('./repl.js', import.meta.url).toString() ] : []),
		'--import', new URL('./loader.js', import.meta.url).toString(),
		...argv
	];

	return spawn(process.execPath, [ ...inheritedExecArgv(process.execArgv, args), ...args ], { stdio, env: spawnEnv });
};
