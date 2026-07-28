import { transform } from 'esbuild';
import repl, { type REPLServer, type REPLEval } from 'node:repl';

const patchEval = (nodeRepl: REPLServer) => {
	const { eval: defaultEval } = nodeRepl;
	const preEval: REPLEval = async function(code, context, sourcefile, callback) {
		const options = {
			sourcefile, loader: 'ts', tsconfigRaw: { compilerOptions: { preserveValueImports: true } }, define: { require: 'global.require' }
		} satisfies Parameters<typeof transform>[1];

		try { ({ code } = (await transform(code, options))) } catch {}

		return defaultEval.call(this, code, context, sourcefile, callback);
	};

	// @ts-expect-error overwriting read-only property
	nodeRepl.eval = preEval;

	return nodeRepl;
};

const { start } = repl;
repl.start = function() {
	return patchEval(Reflect.apply(start, this, arguments));
};
