import { isAbsolute, join, relative, matchesGlob, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as osConstants } from 'node:os';
import { parseArgs } from 'node:util';
import { Watchr, type WatchrEventHandler } from '@d1g1tal/watchr';
import { lightMagenta, lightGreen, yellow } from '../utils/ansi';
import { run } from '../run';
import { noop } from '../utils/constants';
import { findFirstPositionalIndex, removeArgvFlags } from '../remove-argv-flags';
import { closeIpcServer, createIpcServer } from '../utils/ipc/server';
import { clearScreen, log } from './utils';
import { debugEnabled } from '../utils/debug';
import type { ChildProcess } from 'node:child_process';
import type { DependencyMessage, Flags } from '../types';

const flags: Flags = {
	noCache: { type: Boolean },
	tsconfig: { type: String },
	clearScreen: { type: Boolean },
	include: { type: [String] },
	exclude: { type: [String] },
	help: { type: Boolean, alias: 'h' }
} as const;

const isString = (entry: unknown): entry is string => typeof entry === 'string';
const toStringArray = (value: unknown) => {
	if (!value) { return [] }

	return Array.isArray(value) ? value.filter(isString) : typeof value === 'string' ? [ value ] : [];
};

const printWatchHelp = () => {
	process.stdout.write('Run the script and watch for changes\n');
	process.stdout.write('Usage: tsnode watch [options] <script path> [arguments]\n');
};

const normalizePath = (filePath: string) => filePath.replace(/\\/g, '/');

/**
 * `path.matchesGlob` throws on malformed patterns; treat those as non-matching.
 * @param filePath The file path to test.
 * @param pattern The glob pattern to test against.
 * @returns True if the file path matches the glob pattern, false otherwise.
 */
const safeMatchesGlob = (filePath: string, pattern: string) => {
	try { return matchesGlob(filePath, pattern) } catch { return false }
};

const isDependencyMessage = (data: unknown): data is DependencyMessage => (data !== null && typeof data === 'object' && 'type' in data && data.type === 'dependency' && 'path' in data && typeof data.path === 'string');
const terminatedChildren = new WeakSet<ChildProcess>();
const terminatingChildren = new WeakMap<ChildProcess, Promise<number | null>>();
const hasTerminated = (child: ChildProcess) => terminatedChildren.has(child) || child.exitCode !== null || child.signalCode != null;

export const terminateProcess = (child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM', timeout = 5000): Promise<number | null> => {
	if (hasTerminated(child) || child.pid === undefined) { return Promise.resolve(child.exitCode) }

	const pending = terminatingChildren.get(child);

	if (pending) {
		if (signal === 'SIGKILL') {
			try { child.kill(signal) } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))) }
		}

		return pending;
	}

	let finish: (error?: Error) => void = noop;
	const termination = new Promise<number | null>((resolve, reject) => {
		let settled = false;
		const forceTimer = setTimeout(() => {
			try { child.kill('SIGKILL') } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
		}, timeout);
		const deadline = setTimeout(() => finish(new Error('Child process did not terminate after SIGKILL')), timeout + 1000);
		const onExit = () => { terminatedChildren.add(child); finish() };
		const onError = (error: Error) => { terminatedChildren.add(child); finish(error) };

		finish = (error) => {
			if (settled) { return }

			settled = true;

			clearTimeout(forceTimer);
			clearTimeout(deadline);
			child.removeListener('exit', onExit);
			child.removeListener('error', onError);

			if (error) { reject(error) } else { resolve(child.exitCode) }
		};

		child.once('exit', onExit);
		child.once('error', onError);

		if (hasTerminated(child) || child.pid === undefined) {
			finish();

			return;
		}
	});

	terminatingChildren.set(child, termination);

	if (!hasTerminated(child)) {
		try { child.kill(signal) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
	}

	return termination;
};

export const runWatchCommand = async (commandArgv = process.argv.slice(3)) => {
	const firstPositionalIndex = findFirstPositionalIndex(flags, commandArgv);
	const scriptPath = commandArgv[firstPositionalIndex];
	const leadingArgv = firstPositionalIndex === -1 ? commandArgv : commandArgv.slice(0, firstPositionalIndex);
	const { values } = parseArgs({
		args: leadingArgv,
		allowPositionals: true,
		strict: false,
		options: {
			'no-cache': { type: 'boolean' },
			tsconfig: { type: 'string' },
			'clear-screen': { type: 'boolean' },
			include: { type: 'string', multiple: true },
			exclude: { type: 'string', multiple: true },
			help: { type: 'boolean', short: 'h' }
		}
	});

	if (values.help && firstPositionalIndex === -1) {
		printWatchHelp();

		return;
	}

	if (firstPositionalIndex === -1 || scriptPath === undefined) {
		process.stderr.write('Error: Missing required parameter "script path"\n');
		process.exitCode = 1;

		return;
	}

	const cwd = process.cwd();
	const rawArgvFlags = removeArgvFlags(flags, [ ...commandArgv ]);
	const targetMapper = (target: string) => isAbsolute(target) ? target : join(cwd, target);
	const options = {
		noCache: Boolean(values['no-cache']),
		tsconfigPath: typeof values.tsconfig === 'string' ? values.tsconfig : undefined,
		clearScreen: values['clear-screen'] ?? true,
		include: toStringArray(values.include),
		exclude: toStringArray(values.exclude),
		ipc: true
	};

	// Keep explicit targets independent of runtime dependency reconciliation.
	const watchTargets = [ scriptPath, ...options.include ].map(targetMapper);
	const isInitialTarget = (dependencyPath: string) => watchTargets.some(target => dependencyPath === target || dependencyPath.startsWith(target.endsWith(sep) ? target : `${target}${sep}`));

	const isIgnoredPath = (targetPath: string) => {
		const normalizedPath = normalizePath(targetPath);

		// Hidden directories and files
		if (normalizedPath.split('/').some(segment => segment.startsWith('.') && segment.length > 1)) {
			return true;
		}

		// 3rd party packages
		if (normalizedPath.includes('/node_modules/') || normalizedPath.includes('/bower_components/') || normalizedPath.includes('/vendor/')) {
			return true;
		}

		for (const excludePattern of options.exclude) {
			const normalizedPattern = normalizePath(excludePattern);
			const absolutePattern = normalizePath(isAbsolute(excludePattern) ? excludePattern : join(cwd, excludePattern));

			if (safeMatchesGlob(normalizedPath, normalizedPattern) || safeMatchesGlob(normalizedPath, absolutePattern)) {
				return true;
			}
		}

		return false;
	};

	let runProcess: ChildProcess | undefined;
	let exiting = false;
	let rerunInProgress = false;
	let rerunQueued = false;
	let ready = false;
	const currentRuntimeDependencyPaths = new Set<string>();
	const dependencyWatchers = new Map<string, Watchr>();
	const registeringDependencies = new Map<string, Promise<void>>();
	let reRun: (event?: string, filePath?: string) => void | Promise<void> = noop;

	const server = await createIpcServer().catch((error: unknown) => {
		process.exitCode = 1;
		process.stderr.write(`Watch failed: ${String(error)}\n`);

		return undefined;
	});

	if (!server) { return }

	const onWatchEvent: WatchrEventHandler<'all'> = (event) => {
		if (event.initial) { return }
		const changedPath = event.type === 'rename' || event.type === 'renameDir' ? event.to : event.path;
		const relativePath = relative(cwd, changedPath);

		void reRun(event.type, relativePath.length > 0 && !relativePath.startsWith('..') ? relativePath : changedPath);
	};
	const watchrOptions = {
		emitInitial: false,
		ignore: isIgnoredPath,
		recursive: true,
		handlers: {
			all: onWatchEvent,
			error: (error: Error) => { void fail(error) }
		}
	};

	let watcher: Watchr;

	try { watcher = new Watchr(watchTargets, watchrOptions) } catch (error) {
		await closeIpcServer(server);

		process.exitCode = 1;
		process.stderr.write(`Watch failed: ${String(error)}\n`);

		return;
	}

	let shutdownPromise: Promise<void> | undefined;
	let signalExitRequested = false;
	const onStdin = () => { void reRun('Return key') };
	const shutdown = (signal: NodeJS.Signals = 'SIGTERM') => {
		exiting = true;

		if (shutdownPromise) {
			if (runProcess && !hasTerminated(runProcess)) { void terminateProcess(runProcess, 'SIGKILL').catch(noop) }

			return shutdownPromise;
		}

		process.stdin.removeListener('data', onStdin);
		process.stdin.pause();
		watcher.close();

		for (const dependencyWatcher of dependencyWatchers.values()) { dependencyWatcher.close() }

		dependencyWatchers.clear();

		shutdownPromise = Promise.all([ runProcess ? terminateProcess(runProcess, signal) : Promise.resolve(), closeIpcServer(server) ])
			.then(noop)
			.finally(() => {
				process.removeListener('SIGINT', relaySignal);
				process.removeListener('SIGTERM', relaySignal);
			});

		return shutdownPromise;
	};
	const fail = async (error: unknown) => {
		if (exiting) { await shutdownPromise?.catch(noop); return }
		process.exitCode = 1;
		process.stderr.write(`Watch failed: ${error instanceof Error ? error.message : String(error)}\n`);
		try { await shutdown() } catch (cleanupError) {
			process.stderr.write(`Watch cleanup failed: ${String(cleanupError)}\n`);
		}
	};
	const relaySignal = (signal: NodeJS.Signals) => {
		const wasRunning = runProcess !== undefined && !hasTerminated(runProcess);
		const shuttingDown = shutdown(signal);

		if (signalExitRequested) { return }

		signalExitRequested = true;

		void shuttingDown.then(() => process.exit(runProcess ? runProcess.exitCode ?? (wasRunning && runProcess.signalCode ? 128 + osConstants.signals[runProcess.signalCode] : 0) : osConstants.signals[signal]), (error: unknown) => {
			process.stderr.write(`Watch cleanup failed: ${String(error)}\n`);
			process.exit(1);
		});
	};

	process.on('SIGINT', relaySignal);
	process.on('SIGTERM', relaySignal);
	server.on('error', (error: unknown) => { void fail(error) });

	server.on('data', (data: unknown) => {
		if (exiting) { return }

		if (data && typeof data === 'object' && 'type' in data && data.type === 'dependency-overflow') {
			void fail(new Error('IPC dependency queue overflow; watch coverage is incomplete'));
			return;
		}

		// Collect run-time dependencies to watch
		if (isDependencyMessage(data)) {
			let dependencyPath: string;
			try { dependencyPath = data.path.startsWith('file:') ? fileURLToPath(data.path) : data.path } catch (error) { return void fail(error) }

			if (isAbsolute(dependencyPath)) {
				dependencyPath = resolve(dependencyPath);
				if (isIgnoredPath(dependencyPath) || isInitialTarget(dependencyPath)) { return }
				currentRuntimeDependencyPaths.add(dependencyPath);

				// Register a new watcher for this dependency if it is not already being watched or registered
				if (!dependencyWatchers.has(dependencyPath) && !registeringDependencies.has(dependencyPath)) {
					const registration = (async () => {
						try {
							const dependencyWatcher = new Watchr(dependencyPath, watchrOptions);
							dependencyWatchers.set(dependencyPath, dependencyWatcher);

							await dependencyWatcher.start();

							if (!exiting && debugEnabled) { log('Watching dependency', dependencyPath) }
						} catch (error) {
							await fail(new Error(`Cannot watch dependency ${dependencyPath}: ${String(error)}`));
						}
					})().finally(() => {
						registeringDependencies.delete(dependencyPath);
					});

					registeringDependencies.set(dependencyPath, registration);
				} else if (!registeringDependencies.has(dependencyPath) && debugEnabled) {
					log('Watching dependency', dependencyPath);
				}
			}
		}
	});

	const reconcileRuntimeDependencies = async () => {
		await Promise.all(registeringDependencies.values());

		// Remove any watched runtime dependencies that are no longer current
		for (const [ dependencyPath, dependencyWatcher ] of dependencyWatchers) {
			if (!currentRuntimeDependencyPaths.has(dependencyPath)) {
				dependencyWatcher.close();
				dependencyWatchers.delete(dependencyPath);
			}
		}

		currentRuntimeDependencyPaths.clear();
	};

	const spawnProcess = () => {
		if (exiting) { return }

		const child = run(rawArgvFlags, options);
		child.once('exit', () => terminatedChildren.add(child));
		child.once('error', (error) => { terminatedChildren.add(child); void fail(error) });

		return child;
	};

	/**
	 * Re-run the process on file changes or manual triggers
	 * @param event The type of file system event that triggered the re-run
	 * @param filePath The path of the file that triggered the re-run, if applicable
	 */
	reRun = async (event?: string, filePath?: string) => {
		const reason = event ? `${lightMagenta(event)}${filePath ? ` in ${lightGreen(`./${filePath}`)}` : ''}` : '';

		if (rerunInProgress) {
			if (event) { rerunQueued = true }

			return;
		}

		rerunInProgress = true;

		try {
			if (exiting || !ready) { return }

			// If not first run
			if (runProcess) {
				// If process still running
				if (!hasTerminated(runProcess)) {
					log(reason, yellow('Restarting...'));
					await terminateProcess(runProcess);
				} else {
					log(reason, yellow('Rerunning...'));
				}

				if (options.clearScreen) { process.stdout.write(clearScreen) }

				await reconcileRuntimeDependencies();
			}

			runProcess = spawnProcess();
		} catch (error) {
			await fail(error);
		} finally {
			rerunInProgress = false;
			if (rerunQueued && !exiting) {
				rerunQueued = false;
				await reRun();
			}
		}
	};

	try {
		await watcher.start();

		if (exiting) { return }

		ready = true;
		await reRun();
	} catch (error) {
		await fail(error);
	}

	if (exiting) { return }

	/**
	 * On "Return" key
	 * Ideally, we can get a list of files loaded from the run above and only watch those files, but it's not possible to detect
	 * the full dependency-tree at run-time because they can be hidden in a if-condition/async-delay.
	 *
	 * Watch explicit targets and dependencies reported by the child instead of the entire cwd.
	 */
	process.stdin.on('data', onStdin);
};
