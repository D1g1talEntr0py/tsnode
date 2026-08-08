import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createFixture } from 'fs-fixture';
import { isFeatureSupported, type Version } from '../../src/utils/node-features';
import type { SpecifierStyle } from './utils/generate-fixture';
import { scenarios, type Scenario } from './utils/scenarios';
import { resolveComparison, type ComparisonImplementation } from './utils/resolve-tsx';
import { resolveNode, type NodeBinary } from './utils/resolve-node';
import { runOnce, type RunResult } from './utils/run';
import { mean, standardDeviation, linearFit } from './utils/stats';

const specifierStyles: SpecifierStyle[] = ['ts', 'js', 'extensionless'];
const scaleCounts = [10, 100, 300, 1000];

const parsed = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	strict: false,
	options: {
		compare: {
			type: 'string',
			short: 'c',
			multiple: true,
		},
		node: {
			type: 'string',
			short: 'n',
			multiple: true,
		},
		modules: {
			type: 'string',
			short: 'm',
		},
		specifier: {
			type: 'string',
			short: 's',
		},
		runs: {
			type: 'string',
			short: 'r',
		},
		cold: {
			type: 'boolean',
		},
		scale: {
			type: 'boolean',
		},
		json: {
			type: 'boolean',
		},
		help: {
			type: 'boolean',
			short: 'h',
		},
	},
});

if (parsed.values.help) {
	process.stdout.write('Measures tsnode startup across scenarios, Node versions, and project sizes\n');
	process.stdout.write('Usage: tsnode tests/benchmarks/index.ts [scenarios...] [options]\n');
	process.exit(0);
}

const compare = (parsed.values.compare ?? []) as string[];
const nodeVersions = (parsed.values.node ?? []) as string[];
const modules = Number(parsed.values.modules ?? 1000);
const specifier = (parsed.values.specifier ?? 'ts') as SpecifierStyle;
const runs = Number(parsed.values.runs ?? 5);
const cold = Boolean(parsed.values.cold);
const scale = Boolean(parsed.values.scale);
const json = Boolean(parsed.values.json);

if (!Number.isFinite(modules) || modules <= 0) {
	throw new Error(`Invalid --modules value: ${String(parsed.values.modules)}`);
}

if (!Number.isFinite(runs) || runs <= 0) {
	throw new Error(`Invalid --runs value: ${String(parsed.values.runs)}`);
}

if (!specifierStyles.includes(specifier)) {
	throw new Error(`Invalid specifier style: ${specifier}`);
}

const selectedScenarios = (
	parsed.positionals.length > 0
		? parsed.positionals.map((name) => {
			const scenario = scenarios.find(s => s.name === name);
			if (!scenario) {
				throw new Error(`Unknown scenario "${name}". Available: ${scenarios.map(s => s.name).join(', ')}`);
			}
			return scenario;
		})
		: scenarios.filter(scenario => scenario.default)
);

const moduleCounts = scale ? scaleCounts : [modules];
const log = (message = '') => process.stderr.write(`${message}\n`);
const out = (message = '') => process.stdout.write(`${message}\n`);

await using benchmarkCacheRoot = await createFixture();
const isolatedCacheEnv = {
	TEMP: benchmarkCacheRoot.path,
	TMP: benchmarkCacheRoot.path,
	TMPDIR: benchmarkCacheRoot.path,
};
const preservedCacheDirectories = new Set(['node-compile-cache']);
const clearTransformCache = async () => {
	for (const entry of await fs.readdir(benchmarkCacheRoot.path)) {
		if (!preservedCacheDirectories.has(entry)) {
			await fs.rm(path.join(benchmarkCacheRoot.path, entry), { recursive: true, force: true });
		}
	}
};

type Row = {
	scenario: string;
	nodeVersion: string;
	impl: string;
	moduleCount: number;
	results: RunResult[];
};

const measureCell = async (
	scenario: Scenario,
	node: NodeBinary,
	cliPath: string,
	fixturePath: string,
): Promise<RunResult[]> => {
	const entryPath = path.join(fixturePath, scenario.entry);
	const args = scenario.args ? scenario.args(entryPath, cliPath) : (scenario.runner === 'tsx' ? [cliPath, entryPath] : [entryPath]);
	const usesCache = scenario.runner === 'tsx';

	// Reset cache before warmup: avoids stale-file skew and cross-cell pollution
	if (usesCache) {
		await clearTransformCache();
	}
	await runOnce(node.path, args, fixturePath, isolatedCacheEnv);

	const results: RunResult[] = [];
	for (let run = 0; run < runs; run += 1) {
		if (usesCache && cold) {
			await clearTransformCache();
		}
		results.push(await runOnce(node.path, args, fixturePath, isolatedCacheEnv));
	}
	return results;
};

// Resolve Node binaries (current + any --node), de-duplicated by version
const nodeBinaries: NodeBinary[] = [];
const resolvedBinaries = await Promise.all([
	resolveNode(),
	...nodeVersions.map(version => resolveNode(version)),
]);
for (const binary of resolvedBinaries) {
	if (!nodeBinaries.some(existing => existing.version === binary.version)) {
		nodeBinaries.push(binary);
	}
}

// tsx implementations: local + comparisons (npm/path)
await using installRoot = await createFixture();
const implementations: ComparisonImplementation[] = [
	{
		name: 'local',
		cliPath: fileURLToPath(new URL('../../dist/cli.js', import.meta.url)),
	},
	...await Promise.all(
		compare.map(comparison => resolveComparison(comparison, installRoot.path)),
	),
];

const rows: Row[] = [];
const skipped: string[] = [];

// Measurements are intentionally sequential: concurrent child processes
// would contend for CPU and corrupt the timings.
for (const scenario of selectedScenarios) {
	// Build each fixture once per module count; reuse across nodes and cells
	const fixtures = await Promise.all(moduleCounts.map(
		moduleCount => createFixture(scenario.build(moduleCount, specifier)),
	));
	await using _scenarioFixtures = {
		[Symbol.asyncDispose]: async () => {
			await Promise.all(fixtures.map(fixture => fixture.rm()));
		},
	};

	for (const node of nodeBinaries) {
		if (
			scenario.supportedNodeVersions
			&& !isFeatureSupported(
				scenario.supportedNodeVersions,
				node.version.split('.').map(Number) as Version,
			)
		) {
			skipped.push(`${scenario.name} on Node ${node.version} (unsupported)`);
			continue;
		}

		// node-runner scenarios (baseline/native) ignore --compare
		const cells = (
			scenario.runner === 'node' || scenario.implementations === 'local-only'
				? [{
					name: scenario.runner === 'node' ? 'node' : 'local',
					cliPath: scenario.runner === 'node' ? '' : implementations[0].cliPath,
				}]
				: implementations
		);
		for (const { name, cliPath } of cells) {
			for (const [index, moduleCount] of moduleCounts.entries()) {
				log(`  ${scenario.name} · Node ${node.version} · ${name} · ${moduleCount} modules`);
				const results = await measureCell(scenario, node, cliPath, fixtures[index].path);
				rows.push({
					scenario: scenario.name,
					nodeVersion: node.version,
					impl: name,
					moduleCount,
					results,
				});
			}
		}
	}
}

if (json) {
	process.stdout.write(`${JSON.stringify({
		meta: {
			runs,
			cold,
			scale,
			specifier,
		},
		rows,
	}, null, 2)}\n`);
} else {
	renderTables();
}

function renderTables() {
	out();
	out(`${runs} runs/cell · ${cold ? 'cold' : 'warm'} cache · specifier=${specifier}`);

	for (const scenario of selectedScenarios) {
		const scenarioRows = rows.filter(row => row.scenario === scenario.name);
		if (scenarioRows.length === 0) {
			continue;
		}
		out(`\n## ${scenario.name} — ${scenario.description}`);

		const byNode = new Map<string, Row[]>();
		for (const row of scenarioRows) {
			const list = byNode.get(row.nodeVersion) ?? [];
			list.push(row);
			byNode.set(row.nodeVersion, list);
		}

		for (const [nodeVersion, nodeRows] of byNode) {
			if (scale) {
				out(`Node ${nodeVersion} — scale ${scaleCounts.join('/')}:`);
				const byImpl = new Map<string, Row[]>();
				for (const row of nodeRows) {
					const list = byImpl.get(row.impl) ?? [];
					list.push(row);
					byImpl.set(row.impl, list);
				}
				for (const [impl, implRows] of byImpl) {
					const points = implRows.map(row => ({
						x: row.moduleCount,
						y: mean(row.results.map(result => result.wallMs)),
					}));
					const { slope, intercept } = linearFit(points);
					const detail = points
						.slice()
						.sort((a, b) => a.x - b.x)
						.map(point => `${point.x}→${point.y.toFixed(0)}ms`)
						.join(' ');
					out(`  ${impl.padEnd(20)} ${(slope * 1000).toFixed(1)}µs/module  +${intercept.toFixed(0)}ms fixed   [${detail}]`);
				}
			} else {
				const [count] = moduleCounts;
				out(`Node ${nodeVersion} — ${count} modules:`);
				const localMean = mean(
					(nodeRows.find(row => row.impl === 'local') ?? nodeRows[0])
						.results.map(result => result.wallMs),
				);
				for (const row of nodeRows) {
					// wall is the headline signal; RSS + load/eval split carry little
					// independent signal on synthetic trees (see README) — JSON only.
					const wall = row.results.map(result => result.wallMs);
					const wallMean = mean(wall);
					const relative = (
						row.impl === 'local' || scenario.runner === 'node'
							? ''
							: `  (${(wallMean / localMean).toFixed(2)}x)`
					);
					const name = row.impl.padEnd(20);
					const meanColumn = `mean ${wallMean.toFixed(0)}±${standardDeviation(wall).toFixed(0)}ms`.padEnd(18);
					const minColumn = `min ${Math.min(...wall).toFixed(0)}ms`;
					out(`  ${name}${meanColumn}${minColumn}${relative}`);
				}
			}
		}
	}

	if (skipped.length > 0) {
		out(`\nSkipped:\n${skipped.map(entry => `  ${entry}`).join('\n')}`);
	}
}
