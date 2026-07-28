import { bench, group, run, summary } from 'mitata';
import { createData } from '../../src/hook/initialize';
import { createLoadSync } from '../../src/hook/load';
import { createResolveSync } from '../../src/hook/resolve';

import type { LoadHookContext, LoadHookSync, ResolveHookContext, ResolveHookSync } from 'node:module';

let sink = '';

const resolveData = createData();
const resolveSync = createResolveSync(resolveData);

const namespacedResolveData = createData({ namespace: 'bench' });
const namespacedResolveSync = createResolveSync(namespacedResolveData);

const loadData = createData();
const loadSync = createLoadSync(loadData);

const nextResolveTs: Parameters<ResolveHookSync>[2] = (specifier) => ({
	url: specifier.startsWith('file://') ? specifier : `file:///bench/${specifier.replace(/^\.\//, '')}`,
	format: 'module-typescript',
	importAttributes: {},
	shortCircuit: true,
});

const nextResolveJs: Parameters<ResolveHookSync>[2] = (specifier) => ({
	url: specifier.startsWith('file://') ? specifier : `file:///bench/${specifier.replace(/^\.\//, '')}`,
	format: 'module',
	importAttributes: {},
	shortCircuit: true,
});

const nextLoadJs: Parameters<LoadHookSync>[2] = () => ({
	format: 'module',
	source: 'export const value = 1;',
	shortCircuit: true,
});

const nextLoadTs: Parameters<LoadHookSync>[2] = () => ({
	format: 'typescript',
	source: 'export const value: number = 1;',
	shortCircuit: true,
});

const jsResolveContext = {
	conditions: ['node', 'import'],
	importAttributes: {},
	parentURL: 'file:///bench/main.js',
} as ResolveHookContext;

const tsResolveContext = {
	conditions: ['node', 'import'],
	importAttributes: {},
	parentURL: 'file:///bench/main.ts',
} as ResolveHookContext;

const loadContext = {
	conditions: ['node', 'import'],
	importAttributes: {},
	format: 'module',
} as LoadHookContext;

group('Resolve hook microbenchmarks', () => {
	summary(() => {
		bench('direct .ts resolve (no namespace)', () => {
			sink = resolveSync('./module.ts', tsResolveContext, nextResolveTs).url;
		});

		bench('explicit .js resolve (no namespace)', () => {
			sink = resolveSync('./module.js', jsResolveContext, nextResolveJs).url;
		});

		bench('tsnode protocol resolve (namespace)', () => {
			sink = namespacedResolveSync(
				'tsnode://{"specifier":"./module.ts","parentURL":"file:///bench/main.ts","namespace":"bench"}',
				tsResolveContext,
				nextResolveTs,
			).url;
		});
	});
});

group('Load hook microbenchmarks', () => {
	summary(() => {
		bench('plain JS passthrough', () => {
			const loaded = loadSync('file:///bench/module.js', loadContext, nextLoadJs);
			sink = String(loaded.format);
		});

		bench('TypeScript strip/transform path', () => {
			const loaded = loadSync('file:///bench/module.ts', loadContext, nextLoadTs);
			sink = String(loaded.format);
		});
	});
});

await run({ format: 'mitata', filter: /.*/ });