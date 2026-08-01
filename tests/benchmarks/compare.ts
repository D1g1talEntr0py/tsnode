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
 *   7. Cold cache             – transform cache cleared before each iteration (medium project)
 *
 * IMPORTANT: Memory measurement
 * ─────────────────────────────
 * Mitata measures memory of the parent benchmark process, not the spawned
 * child processes that actually execute TypeScript. Since each child is spawned
 * independently, the parent barely allocates anything — which produced an
 * identical, meaningless reading for every runner. The counter is therefore
 * disabled here rather than printed and misread.
 *
 * For accurate memory measurements:
 *   pnpm benchmark:memory  – Dedicated memory profiler (measures child process RSS)
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
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { createFixture } from 'fs-fixture';
import { bench, run, summary, group } from 'mitata';
import { esmTree, tsconfigForTree } from './utils/generate-fixture';
import { resolveComparison, resolveGlobalTsxPaths } from './utils/resolve-tsx';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const nodePath = process.execPath;
const localCliPath = path.resolve(__dirname, '../../dist/cli.js');
const localLoaderPath = path.resolve(__dirname, '../../dist/loader.js');
const tsnodeBenchmarkEnv = (process.env['TSNODE_COMPARE_FAST_PATH'] === '1' ? { TSNODE_BENCH_FAST_PATH: '1' } : undefined);
const comparisonTargets = ['ts-node', 'jiti', 'esrun'] as const;

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Benchmarks run against a throwaway transform cache. Clearing the real shared
 * cache directory would silently degrade the next real invocation on this
 * machine, and would also let unrelated projects' entries affect results.
 */
const benchmarkTmpdir = mkdtempSync(path.join(os.tmpdir(), 'tsnode-benchmark-'));

/** Applied to every spawn so runners resolve their cache inside the sandbox. */
const isolatedCacheEnv = { TMPDIR: benchmarkTmpdir };

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
	for (const entry of readdirSync(benchmarkTmpdir)) {
		if (preservedCacheDirectories.has(entry)) { continue }

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
		env: { ...process.env, ...isolatedCacheEnv, ...env },
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
};

let comparisonImplementations: ComparisonImplementation[] = [];

const benchComparisonImplementations = (fixturePath: string, excludedNames: string[] = []) => {
	for (const implementation of comparisonImplementations) {
		if (excludedNames.includes(implementation.name)) {
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

process.stdout.write('Setting up benchmark environment…\n');

const tsx = await resolveGlobalTsxPaths();
if (!tsx) {
	process.stderr.write('Warning: tsx not found in PATH — tsx benchmarks will be skipped\n');
}

await using installRoot = await createFixture();
comparisonImplementations = await Promise.all(
	comparisonTargets.map(async target => {
		const implementation = await resolveComparison(target, installRoot.path);
		return {
			name: implementation.name,
			cliPath: implementation.cliPath,
		};
	}),
);

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
		'package.json': JSON.stringify({ type: 'module' }),
		...tsconfigForTree,
		'main.ts': simpleTsContent,
	}),
	// small: 10-module ESM tree
	createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		...tsconfigForTree,
		...esmTree(10, 'ts'),
	}),
	// medium: 100-module ESM tree
	createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		...tsconfigForTree,
		...esmTree(100, 'ts'),
	}),
	// medium (cold-cache): baseline tsconfig
	createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		...tsconfigForTree,
		...esmTree(100, 'ts'),
	}),
	// large: 300-module ESM tree
	createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		...tsconfigForTree,
		...esmTree(300, 'ts'),
	}),
	// complex: single file with enums + namespaces
	createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		...tsconfigForTree,
		'main.ts': complexTsContent,
	}),
	// baseline: plain .js, no TypeScript
	createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		'main.js': baselineMjsContent,
	}),
]);

process.stdout.write('Fixtures ready. Warming caches…\n');

// Warm the transform caches by running each runner once before benchmarks.
// This ensures "warm" groups measure steady-state performance.
const warmupRuns: Promise<void>[] = [
	spawnTsnodeCli(simpleFixture.path),
	spawnTsnodeCli(smallFixture.path),
	spawnTsnodeCli(mediumFixture.path),
	spawnTsnodeCli(largeFixture.path),
	spawnTsnodeCli(complexFixture.path),
	spawnTsnodeImport(simpleFixture.path),
	spawnTsnodeImport(smallFixture.path),
	spawnTsnodeImport(mediumFixture.path),
	spawnTsnodeImport(largeFixture.path),
	spawnTsnodeImport(complexFixture.path),
];
if (tsx) {
	warmupRuns.push(
		spawn([tsx.cli, 'main.ts'], simpleFixture.path),
		spawn([tsx.cli, 'main.ts'], smallFixture.path),
		spawn([tsx.cli, 'main.ts'], mediumFixture.path),
		spawn([tsx.cli, 'main.ts'], largeFixture.path),
		spawn([tsx.cli, 'main.ts'], complexFixture.path),
		spawn(['--import', tsx.esmLoader, 'main.ts'], simpleFixture.path),
		spawn(['--import', tsx.esmLoader, 'main.ts'], smallFixture.path),
		spawn(['--import', tsx.esmLoader, 'main.ts'], mediumFixture.path),
		spawn(['--import', tsx.esmLoader, 'main.ts'], largeFixture.path),
		spawn(['--import', tsx.esmLoader, 'main.ts'], complexFixture.path),
	);
}
for (const implementation of comparisonImplementations) {
	warmupRuns.push(
		spawn([implementation.cliPath, 'main.ts'], simpleFixture.path),
		spawn([implementation.cliPath, 'main.ts'], smallFixture.path),
		spawn([implementation.cliPath, 'main.ts'], mediumFixture.path),
		...(implementation.name === 'esrun'
			? []
			: [spawn([implementation.cliPath, 'main.ts'], largeFixture.path)]),
		...(implementation.name === 'ts-node'
			? []
			: [spawn([implementation.cliPath, 'main.ts'], complexFixture.path)]),
	);
}
// Run warmups sequentially to avoid CPU contention skewing the first real runs
for (const warmup of warmupRuns) {
	await warmup;
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

		if (tsx) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsx.esmLoader, 'main.ts'], simpleFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsx.cli, 'main.ts'], simpleFixture.path);
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

		if (tsx) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsx.esmLoader, 'main.ts'], smallFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsx.cli, 'main.ts'], smallFixture.path);
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

		if (tsx) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsx.esmLoader, 'main.ts'], mediumFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsx.cli, 'main.ts'], mediumFixture.path);
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

		if (tsx) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsx.esmLoader, 'main.ts'], largeFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsx.cli, 'main.ts'], largeFixture.path);
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

		if (tsx) {
			bench('--import tsx', async () => {
				await spawn(['--import', tsx.esmLoader, 'main.ts'], complexFixture.path);
			});

			bench('tsx', async () => {
				await spawn([tsx.cli, 'main.ts'], complexFixture.path);
			});
		}

		benchComparisonImplementations(complexFixture.path, ['ts-node']);
	});
});

// ── 6. Cold cache — medium project ──────────────────────────────────────────
// Clears the on-disk transform cache before every iteration to simulate a
// first-run scenario (e.g. after install or on CI).
// Note: cache-clear (~1–5 ms) is included in the measurement but is negligible
// relative to the 100–300 ms process-startup cost.
group('Cold cache — medium project (100 modules, cache cleared each run)', () => {
	summary(() => {
		bench('--import tsnode (cold)', async () => {
			await clearTransformCache();
			await spawnTsnodeImport(coldMediumFixture.path);
		});

		bench('tsnode (cold)', async () => {
			await clearTransformCache();
			await spawnTsnodeCli(coldMediumFixture.path);
		});

		if (tsx) {
			bench('--import tsx (cold)', async () => {
				await clearTransformCache();
				await spawn(['--import', tsx.esmLoader, 'main.ts'], coldMediumFixture.path);
			});

			bench('tsx (cold)', async () => {
				await clearTransformCache();
				await spawn([tsx.cli, 'main.ts'], coldMediumFixture.path);
			});
		}

		benchComparisonImplementations(coldMediumFixture.path);

		// --strip-types has no transform cache; every run is effectively cold
		bench('node --strip-types (no cache)', async () => {
			await spawn(['--strip-types', 'main.ts'], coldMediumFixture.path);
		});
	});
});

// ── 7. CLI signal-relay overhead ───────────────────────────────────────────
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

try {
	// Parent-process measurement; meaningless for spawned children
	await run({ format: 'mitata', filter: /.*/, throw: false, gc: false });
} finally {
	// Clean up all fixture directories regardless of benchmark outcome
	await Promise.allSettled([ simpleFixture.rm(), smallFixture.rm(), mediumFixture.rm(), coldMediumFixture.rm(), largeFixture.rm(), complexFixture.rm(), baselineFixture.rm() ]);

	rmSync(benchmarkTmpdir, { recursive: true, force: true });
}
