/**
 * Comprehensive startup benchmark: tsnode vs tsx vs other TS runtimes vs node --strip-types
 *
 * Runners compared:
 *   node             – plain Node.js (.js, no TypeScript) — absolute startup floor
 *   --strip-types    – Node's native type stripping (no transpilation)
 *   tsnode           – this library, CLI mode  (node dist/cli.js entry.ts)
 *   --import tsnode  – this library, loader mode (node --import dist/loader.js entry.ts)
 *   tsx              – tsx CLI
 *   ts-node          – ts-node ESM CLI
 *   jiti             – jiti CLI
 *   esrun            – esrun CLI
 *   --import tsx     – tsx ESM loader mode (node --import tsx/dist/esm/index.js entry.ts)
 *
 * Fixture groups:
 *   1. Startup floor          – single .js vs single .ts (measures hook/cli overhead)
 *   2. Simple TS file         – one module, type annotations only
 *   3. Small project          – 10 ESM modules
 *   4. Medium project         – 100 ESM modules
 *   5. Large project          – 300 ESM modules
 *   6. Complex TypeScript     – enums + namespaces (tsnode/tsx only; strip-types can't handle)
 *   7. Cold cache             – measured via tests/benchmarks/utils/run.ts (not mitata), reported
 *                               separately after the mitata groups. Distinguishes transform-cold
 *                               (V8 compile cache retained) from fully-cold (both caches cleared).
 *   8. Paired CLI vs --import – persistent, alternating-order measurements with median/p90, also
 *                               reported via tests/benchmarks/utils/run.ts after the mitata groups.
 *
 * IMPORTANT: Memory measurement
 * ─────────────────────────────
 * Mitata measures memory of the parent benchmark process, not the spawned
 * child processes that actually execute TypeScript. Since each child is spawned
 * independently, any allocation rows printed by mitata describe the parent's
 * spawning and bookkeeping work, not the child runner's memory footprint.
 *
 * For accurate memory measurements:
 *   pnpm benchmark:memory  – Profiling guide (does not collect measurements)
 *   /usr/bin/time -v node dist/cli.js fixture.ts  – Peak RSS for a single run
 *   node --prof dist/cli.js fixture.ts  – Generate .isolate for detailed profiling
 *
 * Run with:
 *   pnpm benchmark:compare
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawn as spawnProcess } from 'node:child_process';
import { createFixture } from '../utils/fixture';
import { bench, run, summary, group } from 'mitata';
import { esmTree, tsconfigForTree } from './utils/generate-fixture';
import { resolveComparison } from './utils/resolve-tsx';
import { mean, median, percentile } from './utils/stats';
import { gray, lightCyan } from '../../src/utils/ansi';
import { Json } from '../../src/utils/json';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = import.meta.dirname;
const nodePath = process.execPath;
const localCliPath = path.resolve(__dirname, '../../dist/cli.js');
const localLoaderPath = path.resolve(__dirname, '../../dist/loader.js');
const tsnodeBenchmarkEnv = (process.env['TSNODE_COMPARE_FAST_PATH'] === '1' ? { TSNODE_BENCH_FAST_PATH: '1' } : undefined);
const comparisonTargets = ['tsx', 'ts-node', 'jiti', 'esrun'] as const;

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Benchmarks run against a throwaway transform cache. Clearing the real shared
 * cache directory would silently degrade the next real invocation on this
 * machine, and would also let unrelated projects' entries affect results.
 */
let benchmarkTmpdir: string | undefined;

/** Applied to every spawn so runners resolve their cache inside the sandbox. */
const isolatedCacheEnv = () => benchmarkTmpdir ? { TEMP: benchmarkTmpdir, TMP: benchmarkTmpdir, TMPDIR: benchmarkTmpdir } : {};

/**
 * Clears the sandboxed transform caches.
 *
 * `node-compile-cache` is deliberately preserved: it holds V8 bytecode for the
 * runners' own JavaScript, which is not what "cold cache" is measuring. Wiping
 * it made every runner re-compile itself each iteration and inflated the group
 * by ~16ms.
 */
const preservedCacheDirectories = new Set([ 'node-compile-cache' ]);

const clearTransformCache = () => {
	if (!benchmarkTmpdir) { throw new Error('Benchmark temp directory is not initialized'); }

	for (const entry of readdirSync(benchmarkTmpdir)) {
		if (preservedCacheDirectories.has(entry)) { continue }

		rmSync(path.join(benchmarkTmpdir, entry), { recursive: true, force: true });
	}
};

/** Clears everything, including the preserved `node-compile-cache` — a genuinely "fully cold" state. */
const clearAllCaches = () => {
	if (!benchmarkTmpdir) { throw new Error('Benchmark temp directory is not initialized'); }

	for (const entry of readdirSync(benchmarkTmpdir)) {
		rmSync(path.join(benchmarkTmpdir, entry), { recursive: true, force: true });
	}
};

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

/**
 * Spawn a node process and discard all output. Throws on non-zero exit.
 *
 * Every runner inherits the sandboxed TMPDIR so transform caches stay isolated
 * from the machine's real cache.
 */
const spawn = (
	args: string[],
	cwd: string,
	env?: Record<string, string>,
): Promise<void> => new Promise((resolve, reject) => {
	// Keep this path lean so allocation noise doesn't look like tsnode/tsx child memory usage.
	const childProcess = spawnProcess(nodePath, args, {
		cwd,
		env: { ...process.env, ...isolatedCacheEnv(), ...env },
		stdio: 'ignore',
	});

	childProcess.on('error', reject);
	childProcess.on('exit', (exitCode, signal) => {
		if (exitCode === 0) {
			resolve();
			return;
		}

		reject(new Error(`Run failed (${signal ?? `exit ${exitCode}`})`));
	});
});

const mergeTsnodeEnv = (env?: Record<string, string>) => (
	(tsnodeBenchmarkEnv || env)
		? { ...tsnodeBenchmarkEnv, ...env } as Record<string, string>
		: undefined
);

const spawnTsnodeCli = (cwd: string, env?: Record<string, string>) => spawn(
	[localCliPath, 'main.ts'],
	cwd,
	mergeTsnodeEnv(env),
);

const spawnTsnodeImport = (cwd: string, env?: Record<string, string>) => spawn(
	['--import', localLoaderPath, 'main.ts'],
	cwd,
	mergeTsnodeEnv(env),
);

type ComparisonImplementation = {
	name: string;
	cliPath: string;
	esmLoaderPath?: string;
	version?: string;
};

let comparisonImplementations: ComparisonImplementation[] = [];

/**
 * `tsx` is always benched explicitly (CLI + loader mode), so it is excluded
 * here to avoid a duplicate row that also doubles the group's runtime.
 *
 * Cold-cache measurement for these runners now lives in the manual
 * cold-cache report (see `runColdCacheReport`) which separates cache
 * clearing from the timed measurement; this helper only benches warm runs.
 */
const benchComparisonImplementations = (fixturePath: string, excludedNames: string[] = []) => {
	for (const implementation of comparisonImplementations) {
		if (implementation.name === 'tsx' || excludedNames.includes(implementation.name)) {
			continue;
		}
		bench(implementation.name, async () => {
			await spawn([implementation.cliPath, 'main.ts'], fixturePath);
		});
	}
};

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Single, self-contained .ts file — type annotations only. */
const simpleTsContent = `\
const greeting: string = 'hello from TypeScript';
const numbers: number[] = [1, 2, 3, 4, 5];
const doubled: number[] = numbers.map((n: number): number => n * 2);
type Result = { message: string; values: number[] };
const result: Result = { message: greeting, values: doubled };
console.log(JSON.stringify(result));
`;

/** Equivalent .js baseline — no types, same work. */
const baselineMjsContent = `\
const greeting = 'hello from JavaScript';
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map((n) => n * 2);
const result = { message: greeting, values: doubled };
console.log(JSON.stringify(result));
`;

/**
 * Complex TypeScript that requires actual *transpilation* (not just type
 * stripping). This exercises the esbuild transformation path and is
 * intentionally incompatible with `node --strip-types`.
 */
const complexTsContent = `\
// Enums → compiled to IIFE object literals by esbuild
enum Color { Red = 'red', Green = 'green', Blue = 'blue' }
enum Direction { Up = 0, Down, Left, Right }

// Namespaces → compiled to object assignments
namespace Geometry {
  export interface Shape { area(): number; perimeter(): number; }
  export type Point = { x: number; y: number };
  export const origin: Point = { x: 0, y: 0 };

  export class Circle implements Shape {
    constructor(public readonly radius: number) {}
    area(): number { return Math.PI * this.radius ** 2; }
    perimeter(): number { return 2 * Math.PI * this.radius; }
  }

  export class Rectangle implements Shape {
    constructor(
      private readonly width: number,
      private readonly height: number,
    ) {}
    area(): number { return this.width * this.height; }
    perimeter(): number { return 2 * (this.width + this.height); }
  }
}

// Parameter properties, generic constraints, conditional types
function minMax<T extends number>(values: T[]): { min: T; max: T } {
  return { min: Math.min(...values) as T, max: Math.max(...values) as T };
}
type IsNumeric<T> = T extends number ? true : false;
type Flatten<T> = T extends Array<infer U> ? U : T;

const shapes: Geometry.Shape[] = [
  new Geometry.Circle(5),
  new Geometry.Rectangle(4, 6),
  new Geometry.Circle(10),
];

const totalArea: number = shapes.reduce((sum, s) => sum + s.area(), 0);
const color: Color = Color.Red;
const dir: Direction = Direction.Up;
const stats = minMax([1, 7, 3, 9, 2]);
const _flag: IsNumeric<number> = true;
const _flat: Flatten<number[][]> = [1, 2];

console.log(JSON.stringify({ totalArea: totalArea.toFixed(2), color, dir, stats }));
`;

// ---------------------------------------------------------------------------
// Setup: resolve tsx and create all fixtures
// ---------------------------------------------------------------------------

let fixtureCleanup: Array<() => Promise<void>> = [];

try {
	benchmarkTmpdir = mkdtempSync(path.join(os.tmpdir(), 'tsnode-benchmark-'));
	process.stdout.write('Setting up benchmark environment…\n');

await using installRoot = await createFixture();

const readVersion = async (packageJsonPath: string): Promise<string | undefined> => {
	try {
		const packageJson = Json.parse(await fs.readFile(packageJsonPath, 'utf-8')) as { version?: string };
		return packageJson.version;
	} catch {
		return undefined;
	}
};

const formatVersion = (version?: string) => version ?? 'unknown';

const localTsnodeVersion = await readVersion(path.resolve(__dirname, '../../package.json'));
comparisonImplementations = await Promise.all(
	comparisonTargets.map(async target => {
		const implementation = await resolveComparison(target, installRoot.path);
		return implementation;
	}),
);

process.stdout.write('Benchmark versions:\n');
process.stdout.write(`  tsnode: ${formatVersion(localTsnodeVersion)}\n`);
for (const implementation of comparisonImplementations) {
	process.stdout.write(`  ${implementation.name}: ${formatVersion(implementation.version)}\n`);
}
process.stdout.write('\n');

const tsxImplementation = comparisonImplementations.find(implementation => implementation.name === 'tsx');
const tsxEsmLoaderPath = tsxImplementation?.esmLoaderPath;

// Build all fixtures once; they are reused across all benchmark iterations.
// Mitata handles the iteration loop — we only need fixtures on disk.
const [
	simpleFixture,
	smallFixture,
	mediumFixture,
	coldMediumFixture,
	largeFixture,
	complexFixture,
	baselineFixture,
] = await Promise.all([
	// simple: single .ts file
	createFixture({
		'package.json': Json.serialize({ type: 'module' })!,
		...tsconfigForTree,
		'main.ts': simpleTsContent,
	}),
	// small: 10-module ESM tree
	createFixture({
		'package.json': Json.serialize({ type: 'module' })!,
		...tsconfigForTree,
		...esmTree(10, 'ts'),
	}),
	// medium: 100-module ESM tree
	createFixture({
		'package.json': Json.serialize({ type: 'module' })!,
		...tsconfigForTree,
		...esmTree(100, 'ts'),
	}),
	// medium (cold-cache): baseline tsconfig
	createFixture({
		'package.json': Json.serialize({ type: 'module' })!,
		...tsconfigForTree,
		...esmTree(100, 'ts'),
	}),
	// large: 300-module ESM tree
	createFixture({
		'package.json': Json.serialize({ type: 'module' })!,
		...tsconfigForTree,
		...esmTree(300, 'ts'),
	}),
	// complex: single file with enums + namespaces
	createFixture({
		'package.json': Json.serialize({ type: 'module' })!,
		...tsconfigForTree,
		'main.ts': complexTsContent,
	}),
	// baseline: plain .js, no TypeScript
	createFixture({
		'package.json': Json.serialize({ type: 'module' })!,
		'main.js': baselineMjsContent,
	}),
]);
	fixtureCleanup = [
		() => simpleFixture.rm(),
		() => smallFixture.rm(),
		() => mediumFixture.rm(),
		() => coldMediumFixture.rm(),
		() => largeFixture.rm(),
		() => complexFixture.rm(),
		() => baselineFixture.rm(),
	];

process.stdout.write('Fixtures ready. Warming caches…\n');

// Warm the transform caches by running each runner once before benchmarks.
// This ensures "warm" groups measure steady-state performance.
//
// Each entry is a *thunk*, not an already-started promise: starting every spawn
// up front (e.g. `spawnTsnodeCli(...)` directly in this array) begins them all
// concurrently, so a later `for...of await` loop only awaits completion in
// order — it does not run them sequentially. Deferring the call itself until
// the loop reaches it is what makes warm-up genuinely sequential and avoids
// CPU contention skewing the first real runs.
const warmupRuns: (() => Promise<void>)[] = [
	() => spawnTsnodeCli(simpleFixture.path),
	() => spawnTsnodeCli(smallFixture.path),
	() => spawnTsnodeCli(mediumFixture.path),
	() => spawnTsnodeCli(largeFixture.path),
	() => spawnTsnodeCli(complexFixture.path),
	() => spawnTsnodeImport(simpleFixture.path),
	() => spawnTsnodeImport(smallFixture.path),
	() => spawnTsnodeImport(mediumFixture.path),
	() => spawnTsnodeImport(largeFixture.path),
	() => spawnTsnodeImport(complexFixture.path),
];
if (tsxImplementation && tsxEsmLoaderPath) {
	warmupRuns.push(
		() => spawn([tsxImplementation.cliPath, 'main.ts'], simpleFixture.path),
		() => spawn([tsxImplementation.cliPath, 'main.ts'], smallFixture.path),
		() => spawn([tsxImplementation.cliPath, 'main.ts'], mediumFixture.path),
		() => spawn([tsxImplementation.cliPath, 'main.ts'], largeFixture.path),
		() => spawn([tsxImplementation.cliPath, 'main.ts'], complexFixture.path),
		() => spawn(['--import', tsxEsmLoaderPath, 'main.ts'], simpleFixture.path),
		() => spawn(['--import', tsxEsmLoaderPath, 'main.ts'], smallFixture.path),
		() => spawn(['--import', tsxEsmLoaderPath, 'main.ts'], mediumFixture.path),
		() => spawn(['--import', tsxEsmLoaderPath, 'main.ts'], largeFixture.path),
		() => spawn(['--import', tsxEsmLoaderPath, 'main.ts'], complexFixture.path),
	);
}
for (const implementation of comparisonImplementations) {
	warmupRuns.push(
		() => spawn([implementation.cliPath, 'main.ts'], simpleFixture.path),
		() => spawn([implementation.cliPath, 'main.ts'], smallFixture.path),
		() => spawn([implementation.cliPath, 'main.ts'], mediumFixture.path),
		...(implementation.name === 'esrun'
			? []
			: [() => spawn([implementation.cliPath, 'main.ts'], largeFixture.path)]),
		...(implementation.name === 'ts-node'
			? []
			: [() => spawn([implementation.cliPath, 'main.ts'], complexFixture.path)]),
	);
}
// Run warmups sequentially to avoid CPU contention skewing the first real runs
for (const warmup of warmupRuns) {
	await warmup();
}

process.stdout.write('Ready. Running benchmarks…\n\n');

// ---------------------------------------------------------------------------
// Benchmark groups
// ---------------------------------------------------------------------------

// ── 1. Startup floor ────────────────────────────────────────────────────────
// Shows the irreducible cost of each runner on the simplest possible input.
group('Startup floor (single file)', () => {
	summary(() => {
		bench('node (plain .js)', async () => {
			await spawn(['main.js'], baselineFixture.path);
		});

		bench('node --strip-types', async () => {
			await spawn(['--strip-types', 'main.ts'], simpleFixture.path);
		});

		bench('--import tsnode', async () => {
			await spawnTsnodeImport(simpleFixture.path);
		});

		bench('tsnode', async () => {
			await spawnTsnodeCli(simpleFixture.path);
		});

		if (tsxImplementation && tsxEsmLoaderPath) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsxEsmLoaderPath, 'main.ts'], simpleFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsxImplementation.cliPath, 'main.ts'], simpleFixture.path);
			});
		}

		benchComparisonImplementations(simpleFixture.path);
	});
});

// ── 2. Small project (10 modules) ───────────────────────────────────────────
group('Small project — 10 ESM modules', () => {
	summary(() => {
		bench('node --strip-types', async () => {
			await spawn(['--strip-types', 'main.ts'], smallFixture.path);
		});

		bench('--import tsnode', async () => {
			await spawnTsnodeImport(smallFixture.path);
		});

		bench('tsnode', async () => {
			await spawnTsnodeCli(smallFixture.path);
		});

		if (tsxImplementation && tsxEsmLoaderPath) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsxEsmLoaderPath, 'main.ts'], smallFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsxImplementation.cliPath, 'main.ts'], smallFixture.path);
			});
		}

		benchComparisonImplementations(smallFixture.path);
	});
});

// ── 3. Medium project (100 modules) ─────────────────────────────────────────
group('Medium project — 100 ESM modules', () => {
	summary(() => {
		bench('node --strip-types', async () => {
			await spawn(['--strip-types', 'main.ts'], mediumFixture.path);
		});

		bench('--import tsnode', async () => {
			await spawnTsnodeImport(mediumFixture.path);
		});

		bench('tsnode', async () => {
			await spawnTsnodeCli(mediumFixture.path);
		});

		if (tsxImplementation && tsxEsmLoaderPath) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsxEsmLoaderPath, 'main.ts'], mediumFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsxImplementation.cliPath, 'main.ts'], mediumFixture.path);
			});
		}

		benchComparisonImplementations(mediumFixture.path);
	});
});

// ── 4. Large project (300 modules) ──────────────────────────────────────────
group('Large project — 300 ESM modules', () => {
	summary(() => {
		bench('node --strip-types', async () => {
			await spawn(['--strip-types', 'main.ts'], largeFixture.path);
		});

		bench('--import tsnode', async () => {
			await spawnTsnodeImport(largeFixture.path);
		});

		bench('tsnode', async () => {
			await spawnTsnodeCli(largeFixture.path);
		});

		if (tsxImplementation && tsxEsmLoaderPath) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsxEsmLoaderPath, 'main.ts'], largeFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsxImplementation.cliPath, 'main.ts'], largeFixture.path);
			});
		}

		benchComparisonImplementations(largeFixture.path, ['esrun']);
	});
});

// ── 5. Complex TypeScript ────────────────────────────────────────────────────
// Enums, namespaces, and parameter properties require transpilation.
// node --strip-types cannot handle these constructs.
group('Complex TypeScript (enums + namespaces — transpilation required)', () => {
	summary(() => {
		bench('--import tsnode', async () => {
			await spawnTsnodeImport(complexFixture.path);
		});

		bench('tsnode', async () => {
			await spawnTsnodeCli(complexFixture.path);
		});

		if (tsxImplementation && tsxEsmLoaderPath) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsxEsmLoaderPath, 'main.ts'], complexFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsxImplementation.cliPath, 'main.ts'], complexFixture.path);
			});
		}

		benchComparisonImplementations(complexFixture.path, ['ts-node']);
	});
});

// ── 6. Cold cache — medium project ──────────────────────────────────────────
// Runs outside mitata: mitata's `bench()` callback is the timed unit, so
// clearing caches *inside* it (the previous approach) counted cache-clear
// time as if it were startup time. This manual loop clears caches, THEN
// starts the timer immediately before the spawn — only spawn-to-exit is
// timed. `transform-cold` retains the V8 compile cache (the runner's own
// bytecode); `fully-cold` clears everything, including it.
const coldCacheSamples = 12;

const timeSpawn = async (args: string[], cwd: string, env?: Record<string, string>) => {
	const start = performance.now();
	await spawn(args, cwd, env);
	return performance.now() - start;
};

const measureCold = async (clear: () => void, run: () => Promise<number>) => {
	const times: number[] = [];
	for (let i = 0; i < coldCacheSamples; i++) {
		clear();
		times.push(await run());
	}
	return times;
};

type ReportRow = { label: string; values: number[] };

const sparklineChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Bins raw samples into a density histogram, mirroring mitata's per-bench sparkline at our much smaller sample size. */
const renderSparkline = (values: number[]) => {
	const min = Math.min(...values);
	const span = Math.max(...values) - min || 1;
	const bucketCount = Math.min(values.length, 12);
	const buckets = new Array(bucketCount).fill(0);

	for (const value of values) {
		buckets[Math.min(bucketCount - 1, Math.floor(((value - min) / span) * bucketCount))] += 1;
	}

	const maxBucket = Math.max(...buckets);
	return buckets.map(count => sparklineChars[Math.round((count / maxBucket) * (sparklineChars.length - 1))]).join('');
};

/**
 * Mirrors mitata's `ms/iter` + `(min … max)` layout: a highlighted median/histogram
 * line followed by a dimmed range/percentile line, with a blank line between rows.
 */
const printReportTable = (rows: ReportRow[]) => {
	const labelWidth = Math.max(...rows.map(({ label }) => label.length));
	const indent = ' '.repeat(labelWidth);

	for (const { label, values } of rows) {
		const min = Math.min(...values);
		const max = Math.max(...values);
		const medianStr = `${median(values)!.toFixed(2)} ms/iter`.padStart(15);
		const rangeStr = `(${min.toFixed(2)} ms … ${max.toFixed(2)} ms)`;
		const tailStr = `p90 ${percentile(values, 90)!.toFixed(2)} ms   mean ${mean(values).toFixed(2)} ms`;

		process.stdout.write(`    ${label.padEnd(labelWidth)}  ${lightCyan(medianStr)}  ${lightCyan(renderSparkline(values))}\n`);
		process.stdout.write(`    ${indent}  ${gray(rangeStr)}   ${gray(tailStr)}\n\n`);
	}
};

const runColdCacheReport = async () => {
	process.stdout.write('\nCold cache — medium project (100 modules)\n');

	process.stdout.write('  transform-cold (V8 compile cache retained):\n');
	const transformColdRows: ReportRow[] = [
		{ label: '--import tsnode', values: await measureCold(clearTransformCache, () => timeSpawn(['--import', localLoaderPath, 'main.ts'], coldMediumFixture.path, mergeTsnodeEnv())) },
		{ label: 'tsnode', values: await measureCold(clearTransformCache, () => timeSpawn([localCliPath, 'main.ts'], coldMediumFixture.path, mergeTsnodeEnv())) },
	];

	if (tsxImplementation && tsxEsmLoaderPath) {
		transformColdRows.push(
			{ label: '--import tsx', values: await measureCold(clearTransformCache, () => timeSpawn(['--import', tsxEsmLoaderPath, 'main.ts'], coldMediumFixture.path)) },
			{ label: 'tsx', values: await measureCold(clearTransformCache, () => timeSpawn([tsxImplementation.cliPath, 'main.ts'], coldMediumFixture.path)) },
		);
	}

	for (const implementation of comparisonImplementations) {
		if (implementation.name === 'tsx') { continue }
		transformColdRows.push({ label: implementation.name, values: await measureCold(clearTransformCache, () => timeSpawn([implementation.cliPath, 'main.ts'], coldMediumFixture.path)) });
	}

	// --strip-types has no transform cache; every run is effectively cold already
	transformColdRows.push({ label: 'node --strip-types (no cache)', values: await measureCold(() => {}, () => timeSpawn(['--strip-types', 'main.ts'], coldMediumFixture.path)) });

	printReportTable(transformColdRows);

	process.stdout.write('  fully-cold (transform AND V8 compile caches empty):\n');
	printReportTable([
		{ label: '--import tsnode', values: await measureCold(clearAllCaches, () => timeSpawn(['--import', localLoaderPath, 'main.ts'], coldMediumFixture.path, mergeTsnodeEnv())) },
		{ label: 'tsnode', values: await measureCold(clearAllCaches, () => timeSpawn([localCliPath, 'main.ts'], coldMediumFixture.path, mergeTsnodeEnv())) },
	]);
};

// ── 7. Paired CLI vs --import (persistent, alternating order) ──────────────
// Identical fixtures for both variants; which variant runs first alternates
// each sample so scheduling/thermal drift doesn't bias one side.
const pairedSamples = 20;

const runPairedReport = async (
	name: string,
	cwd: string,
	cliArgs: string[],
	importArgs: string[],
	env?: Record<string, string>,
) => {
	const cliTimes: number[] = [];
	const importTimes: number[] = [];

	for (let i = 0; i < pairedSamples; i++) {
		if (i % 2 === 0) {
			cliTimes.push(await timeSpawn(cliArgs, cwd, env));
			importTimes.push(await timeSpawn(importArgs, cwd, env));
		} else {
			importTimes.push(await timeSpawn(importArgs, cwd, env));
			cliTimes.push(await timeSpawn(cliArgs, cwd, env));
		}
	}

	process.stdout.write(`\n  ${name}\n`);
	printReportTable([
		{ label: 'CLI', values: cliTimes },
		{ label: '--import', values: importTimes },
	]);
};

const runPairedReports = async () => {
	process.stdout.write('\nPaired CLI vs --import (persistent, alternating order, 20 samples)\n');

	await runPairedReport(
		'Ordinary execution (single file, warm)',
		simpleFixture.path,
		[localCliPath, 'main.ts'],
		['--import', localLoaderPath, 'main.ts'],
	);

	await runPairedReport(
		'Leading Node flag with runtime equivalent (--enable-source-maps, in-process on CLI)',
		simpleFixture.path,
		[localCliPath, '--enable-source-maps', 'main.ts'],
		['--enable-source-maps', '--import', localLoaderPath, 'main.ts'],
	);

	await using testFixture = await createFixture({
		...tsconfigForTree,
		'package.json': Json.serialize({ type: 'module' })!,
		'main.test.ts': 'import assert from \'node:assert/strict\';\nimport test from \'node:test\';\n\ntest(\'startup\', () => {\n\tassert.equal(1, 1);\n});\n',
	});

	await runPairedReport(
		'node --test (forces fork on CLI)',
		testFixture.path,
		[localCliPath, '--test', 'main.test.ts'],
		['--import', localLoaderPath, '--test', 'main.test.ts'],
	);

	await runPairedReport(
		'Forced signal relay (fork path)',
		simpleFixture.path,
		[localCliPath, 'main.ts'],
		['--import', localLoaderPath, 'main.ts'],
		{ TSNODE_DISABLE_IN_PROCESS: '1', TSNODE_DISABLE_SIGNAL_RELAY: '0', TSNODE_FORCE_SIGNAL_RELAY: '1' },
	);
};

// ── 8. CLI signal-relay overhead ───────────────────────────────────────────
// Isolates parent<->child signal relay setup cost in tsnode CLI mode.
//
// The relay only exists to forward signals to a child process, so these must
// force the fork path. Without TSNODE_DISABLE_IN_PROCESS both variants take the
// in-process fast path, spawn no child, and the group silently measures nothing.
group('CLI signal relay overhead (single file, fork path)', () => {
	summary(() => {
		bench('tsnode (signal relay forced on)', async () => {
			await spawnTsnodeCli(simpleFixture.path, {
				TSNODE_DISABLE_IN_PROCESS: '1',
				TSNODE_DISABLE_SIGNAL_RELAY: '0',
				TSNODE_FORCE_SIGNAL_RELAY: '1',
			});
		});

		bench('tsnode (signal relay forced off)', async () => {
			await spawnTsnodeCli(simpleFixture.path, {
				TSNODE_DISABLE_IN_PROCESS: '1',
				TSNODE_DISABLE_SIGNAL_RELAY: '1',
				TSNODE_FORCE_SIGNAL_RELAY: '0',
			});
		});
	});
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

	// Allocation rows measure the parent, not spawned child RSS.
	await run({ format: 'mitata', filter: /.*/, throw: false });

	// Manual harnesses run after mitata so they don't contend with it for CPU.
	await runColdCacheReport();
	await runPairedReports();
} finally {
	// Clean up all fixture directories regardless of benchmark outcome
	await Promise.allSettled(fixtureCleanup.map((cleanup) => Promise.resolve().then(cleanup)));

	if (benchmarkTmpdir) {
		rmSync(benchmarkTmpdir, { recursive: true, force: true });
	}
}
