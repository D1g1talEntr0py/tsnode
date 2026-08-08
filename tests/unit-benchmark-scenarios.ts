import { describe, expect, test } from 'vitest';
import { createFixture } from 'fs-fixture';
import { runOnce } from './benchmarks/utils/run';
import { scenarios } from './benchmarks/utils/scenarios';

describe('benchmark scenarios', () => {
	test('passes an isolated cache environment to benchmark children', async () => {
		await using fixture = await createFixture({
			'main.js': 'console.log(`__BENCH__${JSON.stringify({ first: Number(process.env.BENCH_VALUE), last: 9, maxRssKb: 1 })}`);',
		});

		const result = await runOnce(process.execPath, ['main.js'], fixture.path, { BENCH_VALUE: '7' });

		expect(result.loadMs).toBe(7);
		expect(result.evalMs).toBe(2);
	});
	test('every scenario has required fields', () => {
		for (const scenario of scenarios) {
			expect(typeof scenario.name, `${scenario.name}: name`).toBe('string');
			expect(typeof scenario.description, `${scenario.name}: description`).toBe('string');
			expect(typeof scenario.entry, `${scenario.name}: entry`).toBe('string');
			expect(typeof scenario.build, `${scenario.name}: build`).toBe('function');
			expect(typeof scenario.default, `${scenario.name}: default`).toBe('boolean');
			expect(['tsx', 'node'], `${scenario.name}: runner`).toContain(scenario.runner);
		}
	});

	test('scenario names are unique', () => {
		const names = scenarios.map(s => s.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test('at least one scenario is in the default set', () => {
		expect(scenarios.some(s => s.default)).toBe(true);
	});

	test('build() returns a non-empty file tree', () => {
		for (const scenario of scenarios) {
			const tree = scenario.build(1, 'ts');
			expect(typeof tree, `${scenario.name}: build() result`).toBe('object');
			expect(Object.keys(tree).length, `${scenario.name}: build() returned empty tree`).toBeGreaterThan(0);
		}
	});
});
