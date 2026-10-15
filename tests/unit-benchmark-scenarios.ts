import { describe, expect, test } from 'vitest';
import { createFixture } from './utils/fixture';
import { runOnce } from './benchmarks/utils/run';
import { scenarios } from './benchmarks/utils/scenarios';
import { metricsReporter } from './benchmarks/utils/generate-fixture';

describe('benchmark scenarios', () => {
	test('samples RSS at exit without changing the evaluation timestamps', async () => {
		await using fixture = await createFixture({
			'main.js': `
				globalThis.__bench = [7];
				let exiting = false;
				process.once('exit', () => { exiting = true; });
				const resourceUsage = process.resourceUsage;
				process.resourceUsage = () => {
					if (!exiting) { throw new Error('Memory sampled before exit'); }
					return { ...resourceUsage(), maxRSS: 1 };
				};
				${metricsReporter}
			`,
		});
		const result = await runOnce(process.execPath, ['main.js'], fixture.path);
		expect(result.loadMs).toBe(7);
		expect(result.evalMs).toBeGreaterThan(0);
		expect(result.maxRssKb).toBeGreaterThan(0);
		if (process.platform === 'linux') { expect(result.maxRssKb).toBeGreaterThan(1) }
	});

	test('passes an isolated cache environment to benchmark children', async () => {
		await using fixture = await createFixture({
			'main.js': 'console.log(`__BENCH__${JSON.stringify({ first: Number(process.env.BENCH_VALUE), last: 9, maxRssKb: 1 })}`);',
		});

		const result = await runOnce(process.execPath, ['main.js'], fixture.path, { BENCH_VALUE: '7' });

		expect(result.loadMs).toBe(7);
		expect(result.evalMs).toBe(2);
	});
	test('every scenario builds its declared entry file', () => {
		for (const scenario of scenarios) {
			const tree = scenario.build(3, 'ts');
			expect(tree[scenario.entry], `${scenario.name}: missing ${scenario.entry}`).toBeDefined();
		}
	});

	test('scenario names are unique', () => {
		const names = scenarios.map(s => s.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test('default scenarios cover the intended benchmark floors', () => {
		expect(scenarios.filter(scenario => scenario.default).map(scenario => scenario.name)).toEqual([
			'node-baseline',
			'hooks-passthrough',
			'esm-ts',
			'native-ts',
		]);
	});
});
