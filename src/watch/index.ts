import { dirname, isAbsolute, join, relative, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as osConstants } from 'node:os';
import { parseArgs } from 'node:util';
import { Watchr } from '@d1g1tal/watchr';
import { lightMagenta, lightGreen, yellow } from '../utils/ansi';
import { run } from '../run';
import { findFirstPositionalIndex, removeArgvFlags, type Flags } from '../remove-argv-flags';
import { createIpcServer } from '../utils/ipc/server';
import { clearScreen, log } from './utils';
import type { ChildProcess } from 'node:child_process';

type DependencyMessage = {
	type: 'dependency';
	path: string;
};

type WatchEventHandler = (event: string, stats: unknown, targetPath: string, targetPathNext?: string) => void;

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

export const runWatchCommand = async (commandArgv = process.argv.slice(3)) => {
	const firstPositionalIndex = findFirstPositionalIndex(flags, commandArgv);
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

	if (firstPositionalIndex === -1) {
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

	// [ scriptPath, ...options.include ] are the initial watch targets. If any of those files are deleted, the watcher will stop watching them.
	// However, if the script imports other files, those will be watched as well (see onWatchEvent).
	const watchTargets = [ commandArgv.slice(firstPositionalIndex)[0], ...options.include ].map(targetMapper);

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
	const currentRuntimeDependencyPaths = new Set<string>();
	const watchedRuntimeDependencyPaths = new Set<string>();
	let reRun: (event?: string, filePath?: string) => void | Promise<void> = () => {};

	const server = await createIpcServer();
	const onWatchEvent: WatchEventHandler = (event: string, _stats: unknown, targetPath: string, targetPathNext?: string) => {
		const changedPath = targetPathNext ?? targetPath;
		const relativePath = relative(cwd, changedPath);

		void reRun(event, relativePath.length > 0 && !relativePath.startsWith('..') ? relativePath : changedPath);
	};
	const watchrOptions = { ignoreInitial: true, ignore: isIgnoredPath, recursive: true, debounce: 100 };
	const watcher = new Watchr(watchTargets, watchrOptions, onWatchEvent);

	server.on('data', (data) => {
		// Collect run-time dependencies to watch
		if (isDependencyMessage(data)) {
			const dependencyPath = data.path.startsWith('file:') ? fileURLToPath(data.path) : data.path;

			if (isAbsolute(dependencyPath)) {
				if (!isIgnoredPath(dependencyPath)) {
					currentRuntimeDependencyPaths.add(dependencyPath);
				}

				if (!watchedRuntimeDependencyPaths.has(dependencyPath) && currentRuntimeDependencyPaths.has(dependencyPath)) {
					watchedRuntimeDependencyPaths.add(dependencyPath);
					void watcher.watchPath(dependencyPath, watchrOptions, onWatchEvent);
				}
			}
		}
	});

	const reconcileRuntimeDependencies = () => {
		for (const dependencyPath of watchedRuntimeDependencyPaths) {
			if (!currentRuntimeDependencyPaths.has(dependencyPath)) {
				watcher.watchersClose(dirname(dependencyPath), dependencyPath);
				watchedRuntimeDependencyPaths.delete(dependencyPath);
			}
		}

		currentRuntimeDependencyPaths.clear();
	};

	const spawnProcess = () => {
		if (exiting) { return }

		return run(rawArgvFlags, options);
	};

	let waitingChildExit = false;

	const killProcess = async (childProcess: ChildProcess, signal: NodeJS.Signals = 'SIGTERM', forceKillOnTimeout = 5000) => {
		let exited = false;
		const forceKillTimer: NodeJS.Timeout = setTimeout(() => {
			if (!exited) {
				log(yellow(`Process didn't exit in ${Math.floor(forceKillOnTimeout / 1000)}s. Force killing...`));
				childProcess.kill('SIGKILL');
			}
		}, forceKillOnTimeout);

		waitingChildExit = true;
		childProcess.kill(signal);

		return new Promise<number | null>((resolve) => {
			childProcess.once('exit', (exitCode) => {
				exited = true;
				waitingChildExit = false;
				clearTimeout(forceKillTimer);
				resolve(exitCode);
			});
		});
	};

	reRun = async (event?: string, filePath?: string) => {
		const reason = event ? `${lightMagenta(event)}${filePath ? ` in ${lightGreen(`./${filePath}`)}` : ''}` : '';

		if (rerunInProgress) {
			if (event) { rerunQueued = true }

			return;
		}

		rerunInProgress = true;

		try {
			if (waitingChildExit) {
				log(reason, yellow('Process hasn\'t exited. Killing process...'));
				runProcess!.kill('SIGKILL');
				return;
			}

			// If not first run
			if (runProcess) {
				// If process still running
				if (runProcess.exitCode === null) {
					log(reason, yellow('Restarting...'));
					await killProcess(runProcess);
				} else {
					log(reason, yellow('Rerunning...'));
				}

				if (options.clearScreen) { process.stdout.write(clearScreen) }

				reconcileRuntimeDependencies();
			}

			runProcess = spawnProcess();
		} finally {
			rerunInProgress = false;
			if (rerunQueued) {
				rerunQueued = false;
				await reRun();
			}
		}
	};

	void reRun();

	const relaySignal = (signal: NodeJS.Signals) => {
		// Disable further spawns
		exiting = true;

		// Child is still running, kill it
		if (runProcess?.exitCode === null) {
			if (waitingChildExit) { log(yellow('Previous process hasn\'t exited yet. Force killing...')) }

			// Second Ctrl+C force kills
			killProcess(runProcess, waitingChildExit ? 'SIGKILL' : signal).then((exitCode) => process.exit(exitCode ?? 0), () => {});
		} else {
			process.exit(osConstants.signals[signal]);
		}
	};

	process.on('SIGINT', relaySignal);
	process.on('SIGTERM', relaySignal);

	/**
	 * Ideally, we can get a list of files loaded from the run above
	 * and only watch those files, but it's not possible to detect
	 * the full dependency-tree at run-time because they can be hidden
	 * in a if-condition/async-delay.
	 *
	 * As an alternative, we watch cwd and all run-time dependencies
	 */
	// On "Return" key
	process.stdin.on('data', () => void reRun('Return key'));
};
