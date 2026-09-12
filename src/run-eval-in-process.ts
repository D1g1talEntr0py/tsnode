import path from 'node:path';
import { runInThisContext } from 'node:vm';
import { pathToFileURL } from 'node:url';

const resolvedPromise = Promise.resolve();

/**
 * Runs transformed ESM eval code in the current process.
 *
 * The synthetic file URL preserves Node's eval semantics for relative imports:
 * `node --input-type=module --eval` resolves `./foo` against `cwd/[eval1]`.
 * @param code The transformed ESM eval code to run.
 * @param scriptArgv The script arguments to pass to the eval code.
 * @returns A promise that resolves when the eval code has finished running.
 */
export const runEvalInProcess = async (code: string, scriptArgv: string[]) => {
	const executablePath = process.argv[0];
	if (executablePath === undefined) { throw new TypeError('Missing executable path') }

	process.argv = [ executablePath, ...scriptArgv ];

	const evalUrl = pathToFileURL(path.join(process.cwd(), '[eval1]')).href;

	(await import('./api/index')).register({ virtualSources: new Map([ [ evalUrl, code ] ]) });

	await import(evalUrl);
};

/**
 * Runs transformed script-style print input in the current process.
 * Mirrors `node --print` completion-value output for transpiled TypeScript.
 * @param code The transformed script-style print input to run.
 * @param scriptArgv The script arguments to pass to the print input.
 */
export const runPrintInProcess = async (code: string, scriptArgv: string[]) => {
	const executablePath = process.argv[0];

	if (executablePath === undefined) { throw new TypeError('Missing executable path') }

	process.argv = [ executablePath, ...scriptArgv ];

	process.stdout.write(`${String(runInThisContext(code, { filename: '[eval]' }))}\n`);

	return resolvedPromise;
};