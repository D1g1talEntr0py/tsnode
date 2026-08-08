import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';

export type RunResult = {

	/** Parent-measured wall time: spawn -> exit. */
	wallMs: number;

	/** Peak RSS in kilobytes (Node's resourceUsage().maxRSS). */
	maxRssKb: number;

	/** Time to first module evaluation ≈ bootstrap + graph load/transform. */
	loadMs: number;

	/** First-to-last evaluation ≈ evaluating the transformed graph. */
	evalMs: number;
};

type BenchLine = {
	first: number;
	last: number;
	maxRssKb: number;
};

const parseBenchLine = (stdout: string): BenchLine | undefined => {
	const line = stdout.split('\n').reverse().find(
		candidate => candidate.startsWith('__BENCH__'),
	);
	if (!line) {
		return;
	}
	return JSON.parse(line.slice('__BENCH__'.length)) as BenchLine;
};

export const runOnce = async (
	nodePath: string,
	args: string[],
	cwd: string,
	env?: NodeJS.ProcessEnv,
): Promise<RunResult> => new Promise((resolve, reject) => {
	const startTime = performance.now();
	let stdout = '';
	let stderr = '';
	const childProcess = spawn(nodePath, args, {
		cwd,
		env: env ? { ...process.env, ...env } : process.env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	childProcess.stdout.setEncoding('utf8');
	childProcess.stderr.setEncoding('utf8');
	childProcess.stdout.on('data', chunk => { stdout += chunk; });
	childProcess.stderr.on('data', chunk => { stderr += chunk; });

	childProcess.on('error', reject);
	childProcess.on('exit', (exitCode) => {
		const wallMs = performance.now() - startTime;

		if (exitCode !== 0) {
			reject(new Error(`Run failed (exit ${exitCode}):\n${stderr}`));
			return;
		}

		const parsed = parseBenchLine(stdout);
		resolve({
			wallMs,
			maxRssKb: parsed?.maxRssKb ?? 0,
			loadMs: parsed?.first ?? 0,
			evalMs: parsed ? parsed.last - parsed.first : 0,
		});
	});
});
