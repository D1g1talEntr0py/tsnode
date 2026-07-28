import type { FileTree } from 'fs-fixture';
import { cliTestFlag, nativeTypeScript, type Version } from '../../../src/utils/node-features';
import {
	createTsconfigForTree,
	esmTree,
	jsTree,
	mixedTsTree,
	nonErasableTsTree,
	tsconfigForTree,
	metricsReporter,
	type SpecifierStyle,
} from './generate-fixture';

export type Scenario = {
	name: string;
	description: string;

	/** Builds the fixture file tree for a given module count + specifier style. */
	build: (moduleCount: number, specifierStyle: SpecifierStyle) => FileTree;

	/** Entry file, relative to the fixture root. */
	entry: string;
	args?: (entryPath: string, cliPath: string) => string[];

	/**
	 * `tsx` runs the entry through the tsx CLI (or a compared tsx).
	 * `node` runs it with plain Node (floor / native type stripping);
	 * these ignore `--compare`.
	 */
	runner: 'tsx' | 'node';
	implementations?: 'all' | 'local-only';

	/**
	 * Node versions the scenario requires, in `node-features.ts` gate format
	 * (checked with `isFeatureSupported`); skipped on unsupported versions.
	 */
	supportedNodeVersions?: Version[];

	/**
	 * Whether this runs when no scenario is named. The default set is the
	 * data-driven high-signal subset (see scripts/benchmark/README.md);
	 * lower-signal / specialized scenarios stay opt-in by name.
	 */
	default: boolean;
};

export const scenarios: Scenario[] = [
	{
		name: 'node-baseline',
		default: true,
		description: 'Plain Node on an empty module — the absolute startup floor (ignores --compare)',
		build: () => ({ 'main.js': `${metricsReporter}\n` }),
		entry: 'main.js',
		runner: 'node',
	},
	{
		name: 'hooks-passthrough',
		default: true,
		description: 'tsnode on a plain-JS tree — hook registration + pass-through resolve/load, zero transforms',
		build: moduleCount => jsTree(moduleCount),
		entry: 'main.js',
		runner: 'tsx',
	},
	{
		name: 'esm-ts',
		default: true,
		description: 'tsnode on a TypeScript ESM tree — transform + resolution hot path (--specifier applies)',
		build: (moduleCount, specifierStyle) => ({
			...tsconfigForTree,
			'package.json': JSON.stringify({ type: 'module' }),
			...esmTree(moduleCount, specifierStyle),
		}),
		entry: 'main.ts',
		runner: 'tsx',
	},
	{
		name: 'esm-ts-enum',
		default: false,
		description: 'TypeScript ESM tree with enums in every module — forces non-erasable syntax fallback',
		build: (moduleCount, specifierStyle) => ({
			...tsconfigForTree,
			'package.json': JSON.stringify({ type: 'module' }),
			...nonErasableTsTree(moduleCount, specifierStyle, 'enum'),
		}),
		entry: 'main.ts',
		runner: 'tsx',
	},
	{
		name: 'esm-ts-namespace',
		default: false,
		description: 'TypeScript ESM tree with namespaces in every module — forces non-erasable syntax fallback',
		build: (moduleCount, specifierStyle) => ({
			...tsconfigForTree,
			'package.json': JSON.stringify({ type: 'module' }),
			...nonErasableTsTree(moduleCount, specifierStyle, 'namespace'),
		}),
		entry: 'main.ts',
		runner: 'tsx',
	},
	{
		name: 'esm-ts-decorator',
		default: false,
		description: 'TypeScript ESM tree with decorators in every module — bypasses native stripping and measures decorator fallback cost',
		build: (moduleCount, specifierStyle) => ({
			...createTsconfigForTree({ experimentalDecorators: true }),
			'package.json': JSON.stringify({ type: 'module' }),
			...nonErasableTsTree(moduleCount, specifierStyle, 'decorator'),
		}),
		entry: 'main.ts',
		runner: 'tsx',
	},
	{
		name: 'esm-ts-mixed-decorator',
		default: false,
		description: 'Mostly erasable TypeScript tree with sparse decorators (every 25th module) — approximates framework-style fallback islands',
		build: (moduleCount, specifierStyle) => ({
			...createTsconfigForTree({ experimentalDecorators: true }),
			'package.json': JSON.stringify({ type: 'module' }),
			...mixedTsTree(moduleCount, specifierStyle, { syntax: 'decorator', fallbackEvery: 25 }),
		}),
		entry: 'main.ts',
		runner: 'tsx',
	},
	{
		name: 'native-ts',
		default: true,
		description: "Node's native type stripping on the TS tree — reference floor (ignores --compare)",
		build: moduleCount => ({
			...tsconfigForTree,
			'package.json': JSON.stringify({ type: 'module' }),
			...esmTree(moduleCount, 'ts'),
		}),
		entry: 'main.ts',
		runner: 'node',
		supportedNodeVersions: nativeTypeScript,
	},
	{
		name: 'cli-test',
		default: false,
		description: 'tsnode CLI test runner mode — isolates fork-required `--test` startup overhead',
		build: () => ({
			...tsconfigForTree,
			'package.json': JSON.stringify({ type: 'module' }),
			'main.test.ts': `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('startup', () => {\n\tassert.equal(1, 1);\n});\n\n${metricsReporter}\n`,
		}),
		entry: 'main.test.ts',
		args: (entryPath, cliPath) => [cliPath, '--test', entryPath],
		runner: 'tsx',
		implementations: 'local-only',
		supportedNodeVersions: cliTestFlag,
	},
];
