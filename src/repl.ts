import { transform } from 'esbuild';
import repl, { type REPLServer, type REPLEval } from 'node:repl';

const patchEval = (nodeRepl: REPLServer) => {
	const { eval: defaultEval } = nodeRepl;
	/**
	 * A custom REPL eval function that transforms TypeScript code to JavaScript before evaluation.
	 * @param code The TypeScript code to evaluate.
	 * @param context The context in which the code is evaluated.
	 * @param sourcefile The source file name for the code being evaluated.
	 * @param callback The callback function to call with the result of the evaluation.
	 */
	const preEval: REPLEval = function(code, context, sourcefile, callback) {
		void (async () => {
			const options = {
				sourcefile, loader: 'ts', tsconfigRaw: { compilerOptions: { preserveValueImports: true } }, define: { require: 'global.require' }
			} satisfies Parameters<typeof transform>[1];

			try { ({ code } = (await transform(code, options))) } catch { /* ignore */ }

			return defaultEval.call(this, code, context, sourcefile, callback);
		})();
	};

	// @ts-expect-error overwriting read-only property
	nodeRepl.eval = preEval;

	return nodeRepl;
};

const { start } = repl;
/**
 * A patched version of the Node.js REPL that transforms TypeScript code to JavaScript before evaluation.
 * @param args The arguments to pass to the Node.js REPL start function.
 * @returns The patched REPL server instance.
 */
repl.start = function(...args) {
	return patchEval(Reflect.apply(start, this, args));
};
