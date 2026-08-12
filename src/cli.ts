import { constants } from 'node:os';
import { enableCompileCache } from 'node:module';
import type { Server } from 'node:net';
import type { Flags } from './remove-argv-flags';
import type { ParseArgsOptionsConfig } from 'node:util';
import type { ChildProcess, Serializable } from 'node:child_process';
import { normalizeFileUrlPath, resolveEntrypointPath } from './utils/path-utils';

type RunInProcess = (code: string, scriptArgv: string[]) => Promise<void>;

if (typeof enableCompileCache === 'function' && process.env['NODE_DISABLE_COMPILE_CACHE'] !== '1') {
	try { enableCompileCache() } catch { /* ignored */ }
}

const relaySignals = (childProcess: ChildProcess, ipcSocket: Server) => {
	let waitForSignal: ((signal: NodeJS.Signals) => void) | undefined;

	ipcSocket.on('data', (data: { type: string, signal: NodeJS.Signals }) => {
		if (data?.type === 'signal' && waitForSignal) { waitForSignal(data.signal) }
	});

	/**
	 * Wait for signal from preflight bindHiddenSignalsHandler
	 * Ideally the timeout should be as low as possible
	 * since the child lets the parent know that it received
	 * the signal
	 * @returns Promise<NodeJS.Signals | undefined> undefined if the child doesn't respond in time
	 */
	const waitForSignalFromChild = () => {
		const signalWaitPromise = new Promise<NodeJS.Signals | undefined>((resolve) => {
			// Small timeout keeps Ctrl+C responsive when the child is hung.
			setTimeout(() => resolve(undefined), 30);
			waitForSignal = resolve;
		});

		signalWaitPromise.then(() => waitForSignal = undefined, () => {});

		return signalWaitPromise;
	};

	const relaySignalToChild = (signal: NodeJS.Signals) => {
		void (async () => {
			/**
			 * This callback is triggered if the parent receives a signal
			 *
			 * Child could also receive a signal at the same time if it detected
			 * a keypress or was sent a signal via process group
			 *
			 * The preflight registers a signal handler on the child to
			 * tell the parent if it also received a signal which we wait for here
			 */
			const signalFromChild = await waitForSignalFromChild();
			/**
			 * If child didn't receive a signal, it's either because it was
			 * sent to the parent directly via kill PID or the child is
			 * unresponsive (e.g. infinite loop). Relay signal to child.
			 */
			if (signalFromChild !== signal) {
				childProcess.kill(signal);

				// If child is unresponsive (e.g. infinite loop), we need to force kill it
				if ((await waitForSignalFromChild()) !== signal) {
					// This seems to run before the handler registered at the bottom of this file
					// Seems the latest handler is called first
					childProcess.on('exit', () => {
						/**
						 * Even though this may not be a SIGKILL, I've confirmed Ctrl+C on an infinite looping
						 * file exits with 130, which is 128 + 2 (SIGINT)
						 *
						 * https://nodejs.org/api/process.html#exit-codes
						 * >128 Signal Exits: If Node.js receives a fatal signal such as SIGKILL or SIGHUP,
						 * then its exit code will be 128 plus the value of the signal code. This is a
						 * standard POSIX practice, since exit codes are defined to be 7-bit integers, and
						 * signal exits set the high-order bit, and then contain the value of the signal code.
						 * For example, signal SIGABRT has value 6, so the expected exit code will be 128 + 6,
						 * or 134.
						 */
						process.exit(128 + constants.signals[signal]);
					});

					childProcess.kill(constants.signals.SIGKILL);
				}
			}
		})();
	};

	process.on('SIGINT', relaySignalToChild);
	process.on('SIGTERM', relaySignalToChild);
};

const tsnodeFlags = {
	noCache: { type: Boolean },
	tsconfig: { type: String }
} satisfies Flags;

const topLevelFlags = {
	...tsnodeFlags,
	version: { type: Boolean, alias: 'v' },
	help: { type: Boolean, alias: 'h' }
} satisfies Flags;

const executionFlags = {
	...topLevelFlags,
	inputType: { type: String },
	test: { type: Boolean },
	eval: { type: String, alias: 'e' },
	print: { type: String, alias: 'p' }
} satisfies Flags;

const parseArgOptions = {
	'no-cache': { type: 'boolean' },
	tsconfig: { type: 'string' },
	version: { type: 'boolean', short: 'v' },
	help: { type: 'boolean', short: 'h' },
	'input-type': { type: 'string' },
	test: { type: 'boolean' },
	eval: { type: 'string', short: 'e' },
	print: { type: 'string', short: 'p' }
} satisfies ParseArgsOptionsConfig;

type CliValuesFromParseOptions<Options extends ParseArgsOptionsConfig> = {
	[Name in keyof Options]?: Options[Name] extends { type: 'string' } ? string : Options[Name] extends { type: 'boolean' } ? boolean : never;
};

type ParsedCliValues = CliValuesFromParseOptions<typeof parseArgOptions>;

const parseCliValues = async (args: string[]) => {
	const { parseArgs } = await import('node:util');

	return parseArgs({ args, allowPositionals: true, strict: false, options: parseArgOptions }).values as ParsedCliValues;
};

type EvalType = Extract<keyof ParsedCliValues, 'eval' | 'print'>;

const getEvalInput = (values: ParsedCliValues) => {
	for (const type of [ 'print', 'eval' ] satisfies EvalType[]) {
		const code = values[type];
		if (code !== undefined) { return { type, code } }
	}

	return undefined;
};

const printHelp = () => {
	process.stdout.write('Node.js runtime enhanced with esbuild for loading TypeScript & ESM\n');
	process.stdout.write('Usage: tsnode [script path] [arguments]\n');
};

const rawArgv = process.argv.slice(2);

if (rawArgv[0] === 'watch') {
	await (await import('./watch/index.js')).runWatchCommand(rawArgv.slice(1));
	process.exitCode ??= 0;
} else {
	const { findFirstPositionalIndex, removeArgvFlags } = await import('./remove-argv-flags');
	const firstPositionalIndex = findFirstPositionalIndex(executionFlags, rawArgv);

	// `tsnode <script>` with no leading flags has nothing to parse. Skipping the
	// call also keeps `node:util` (~3ms to initialize) out of the common path.
	const flagArgv = firstPositionalIndex === -1 ? rawArgv : rawArgv.slice(0, firstPositionalIndex);
	const values: ParsedCliValues = flagArgv.length === 0 ? {} : await parseCliValues(flagArgv);

	if (values.version) {
		// JSON modules only expose a default export; destructuring `version` directly off the namespace yields undefined.
		const { default: { version } } = await import('../package.json', { with: { type: 'json' } });
		process.stdout.write(`tsnode v${version}\nnode `);
	} else if (values.help) {
		printHelp();
		console.log(`${'-'.repeat(45)}\n`);
	}

	const argvFlagsToRun = removeArgvFlags({ ...tsnodeFlags, eval: { type: String, alias: 'e' }, print: { type: String, alias: 'p' } });

	const evalInput = getEvalInput(values);
	const evalScriptArgv = evalInput ? [ ...argvFlagsToRun ] : [];
	let transformedEvalCode: string | undefined;
	let transformedPrintCode: string | undefined;

	if (evalInput) {
		// Lazy import so the CLI parent process doesn't pay esbuild's module init cost on every run (transforms happen in the child process)
		const transformed = (await import('esbuild')).transformSync(evalInput.code, { loader: 'ts', sourcefile: '/eval.ts', ...(evalInput.type === 'eval' ? { format: 'esm' as const } : {}) });
		if (evalInput.type === 'eval') {
			transformedEvalCode = transformed.code;
		} else {
			transformedPrintCode = transformed.code;
		}

		argvFlagsToRun.unshift(`--${evalInput.type}`, transformed.code);
		if (evalInput.type === 'eval' && values['input-type'] !== 'module') { argvFlagsToRun.unshift('--input-type=module') }
	}

	// Default --test glob to find TypeScript files
	if (values.test && firstPositionalIndex === -1) { argvFlagsToRun.push('**/{test,test/**/*,test-*,*[.-_]test}.?(c|m)@(t|j)s') }

	/**
	 * Forking exists to apply Node flags and `--import` preloads at bootstrap, and to relay signals/IPC.
	 * When none of that is needed the entry can run in this process and skip an entire Node bootstrap.
	 *
	 * Deliberately conservative: anything that needs real bootstrap flags, a separate process, or argv rewriting still forks.
	 */
	const [ firstRunArgument ] = argvFlagsToRun;
	const normalizedFirstRunArgument = firstRunArgument && !firstRunArgument.startsWith('-') ? normalizeFileUrlPath(firstRunArgument) : firstRunArgument;
	const resolvedEntrypointPath = normalizedFirstRunArgument && !normalizedFirstRunArgument.startsWith('-') ? resolveEntrypointPath(normalizedFirstRunArgument) : undefined;

	if (normalizedFirstRunArgument !== firstRunArgument && normalizedFirstRunArgument !== undefined) {
		argvFlagsToRun[0] = normalizedFirstRunArgument;
	}

	/**
	 * The following conditions must be met to run in-process:
	 * - ts-node is not disabled via TSNODE_DISABLE_IN_PROCESS
	 * - No top-level flags that require a fork (version, help)
	 * - No eval/print flags that rewrite argv into flags that must be set at bootstrap
	 * - No test flag that rewrites argv into a glob that must be set at bootstrap
	 * - A script path is provided (not REPL or stdin)
	 * - The first argument is not a leading Node flag (e.g. --inspect, --experimental-*)
	 * - The parent process does not expect to exchange IPC messages with a child
	 * - The first argument is a plain file (not a directory or extension-less entry)
	 */
	const canRunInProcess = (process.env['TSNODE_DISABLE_IN_PROCESS'] !== '1' && !values.version && !values.help && !evalInput && !values.test && firstPositionalIndex !== -1 && normalizedFirstRunArgument !== undefined && !normalizedFirstRunArgument.startsWith('-') && !process.send && resolvedEntrypointPath !== undefined);
	const canRunEvalInProcess = process.env['TSNODE_DISABLE_IN_PROCESS'] !== '1' && !values.version && !values.help && (transformedEvalCode !== undefined || transformedPrintCode !== undefined) && !values.test && !process.send && !evalScriptArgv.some((argument) => argument.startsWith('-'));

	if (canRunInProcess) {
		// Consumed at module-init time by the cache and tsconfig loaders, so it must be set before the loader graph is imported.
		if (values['no-cache']) { process.env['TSNODE_DISABLE_CACHE'] = '1' }
		if (typeof values.tsconfig === 'string') { process.env['TSNODE_TSCONFIG_PATH'] = values.tsconfig }

		await (await import('./run-in-process')).runInProcess(argvFlagsToRun, resolvedEntrypointPath);
	} else if (canRunEvalInProcess) {
		const evalModule: { runEvalInProcess: RunInProcess, runPrintInProcess: RunInProcess } = await import('./run-eval-in-process');

		if (transformedPrintCode !== undefined) {
			await evalModule.runPrintInProcess(transformedPrintCode, evalScriptArgv);
		} else if (transformedEvalCode !== undefined)	 {
			await evalModule.runEvalInProcess(transformedEvalCode, evalScriptArgv);
		}
	} else {
		const shouldRelaySignals = (process.env['TSNODE_DISABLE_SIGNAL_RELAY'] !== '1' && (process.env['TSNODE_FORCE_SIGNAL_RELAY'] === '1' || process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY));
		// The child can't be spawned until the socket is listening, so overlap `./run` (node:child_process) with that setup.
		const ipcPromise = shouldRelaySignals ? import('./utils/ipc/server').then(({ createIpcServer }) => createIpcServer()) : undefined;
		const { run } = await import('./run');
		const ipc = await ipcPromise;

		const childProcess = run(argvFlagsToRun, { noCache: Boolean(values['no-cache']), signalRelay: shouldRelaySignals, tsconfigPath: values.tsconfig });

		if (ipc) { relaySignals(childProcess, ipc) }

		const sendToParent = process.send;
		if (sendToParent !== undefined) { childProcess.on('message', (message) => sendToParent(message)) }

		if (childProcess.send) { process.on('message', (message) => childProcess.send(message as Serializable)) }

		// If there's no exit code, it's likely killed by a signal
		// https://nodejs.org/api/process.html#process_exit_codes
		childProcess.on('close', (exitCode) => process.exit(exitCode ?? constants.signals[childProcess.signalCode!] + 128));
	}
}