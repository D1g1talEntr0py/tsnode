import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Runs transformed ESM eval code in the current process.
 *
 * The synthetic file URL preserves Node's eval semantics for relative imports:
 * `node --input-type=module --eval` resolves `./foo` against `cwd/[eval1]`.
 */
export const runEvalInProcess = async (code: string, scriptArgv: string[]) => {
	process.argv = [ process.argv[0], ...scriptArgv ];

	await import('./suppress-warnings');

	const evalUrl = pathToFileURL(path.join(process.cwd(), '[eval1]')).href;

	(await import('./api/index')).register({ virtualSources: new Map([[ evalUrl, code ]]) } as never);

	await import(evalUrl);
};