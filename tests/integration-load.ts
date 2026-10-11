import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { childEnvironment, createProjectFixture } from './utils/fixture';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceResolveHookPath = path.join(import.meta.dirname, 'utils/source-resolve-hook.ts');
const apiPath = (name: string) => pathToFileURL(`${projectRoot}/src/api/${name}.ts`).href;

const runNode = async (script: string, cwd: string, env: Record<string, string> = {}) => {
	const result = await execFileAsync(process.execPath, [
		'--experimental-strip-types',
		'--import', sourceResolveHookPath,
		'--input-type=module',
		'--eval', script,
	], { cwd, env: childEnvironment(env) });

	return JSON.parse(result.stdout);
};

describe('load hook integration', () => {
	test('imports real fragmented TypeScript and TSX files', async () => {
		await using fixture = await createProjectFixture({
			'value.ts': 'export const answer: number = 42;',
			'view.tsx': 'const React = { createElement: () => 7 }; export const answer = <div />;',
		});
		const urls = ['value.ts#fragment', 'view.tsx#fragment'].map(name => new URL(name, pathToFileURL(`${fixture.path}/`).href).href);
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const handle = register({ tsconfig: false });
			try { console.log(JSON.stringify(await Promise.all(${JSON.stringify(urls)}.map(async url => (await import(url)).answer)))); }
			finally { handle.unregister(); }
		`, fixture.path);
		expect(result).toEqual([42, 7]);
	});

	test('applies inherited automatic JSX and legacy inline decorator options', async () => {
		await using fixture = await createProjectFixture({
			'config/base.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'fixture-jsx', experimentalDecorators: true, useDefineForClassFields: false } }),
			'tsconfig.json': JSON.stringify({ extends: './config/base.json' }),
			'node_modules/fixture-jsx/package.json': JSON.stringify({ type: 'module', exports: { './jsx-runtime': './runtime.js' } }),
			'node_modules/fixture-jsx/runtime.js': 'export const jsx = (type, props) => ({ type, props });',
			'view.tsx': 'export const view = <article title="automatic" />;',
			'decorator.ts': 'function mark(target: object, key: string) { target.marked = key; } function make() { class C { @mark value = 7; } return C; } export const marked = new (make())().marked;',
		});
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const handle = register();
			try {
				const view = await import(${JSON.stringify(pathToFileURL(`${fixture.path}/view.tsx`).href)});
				const decorated = await import(${JSON.stringify(pathToFileURL(`${fixture.path}/decorator.ts`).href)});
				console.log(JSON.stringify({ view: view.view, marked: decorated.marked }));
			} finally { handle.unregister(); }
		`, fixture.path);
		expect(result).toEqual({ view: { type: 'article', props: { title: 'automatic' } }, marked: 'value' });
	});

	test('honors assignment class fields on the native-strip candidate path', async () => {
		await using fixture = await createProjectFixture({
			'tsconfig.json': JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
			'fields.ts': 'let calls = 0; class Base { set value(value: number) { calls += value; } } class Child extends Base { value = 7; } new Child(); export const result = calls;',
		});
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const handle = register();
			try { console.log(JSON.stringify((await import(${JSON.stringify(pathToFileURL(`${fixture.path}/fields.ts`).href)})).result)); }
			finally { handle.unregister(); }
		`, fixture.path);
		expect(result).toBe(7);
	});

	test('new registrations invalidate transform results after config edits', async () => {
		await using fixture = await createProjectFixture({
			'tsconfig.json': JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
			'fields.ts': 'enum Amount { Value = 7 } let calls = 0; class Base { set value(value: number) { calls += value; } } class Child extends Base { value = Amount.Value; } new Child(); export const result = calls;',
		});
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			import { writeFileSync } from 'node:fs';
			const results = [];
			for (const [index, define] of [false, true, false].entries()) {
				writeFileSync('tsconfig.json', JSON.stringify({ compilerOptions: { useDefineForClassFields: define } }));
				const handle = register();
				try { results.push((await import(${JSON.stringify(pathToFileURL(`${fixture.path}/fields.ts`).href)} + '?registration=' + index)).result); }
				finally { handle.unregister(); }
			}
			console.log(JSON.stringify(results));
		`, fixture.path);
		expect(result).toEqual([7, 0, 7]);
	});

	test('keeps explicit import type semantics on the native-strip path', async () => {
		await using fixture = await createProjectFixture({
			'types.ts': 'throw new Error("type-only module must not execute"); export interface Shape { value: number }',
			'effect.ts': 'globalThis.effects = (globalThis.effects ?? 0) + 1; export const unused = 1;',
			'entry.ts': 'import type { Shape } from "./types.ts"; import { unused } from "./effect.ts"; export const value: Shape = { value: 42 }; export const effects = globalThis.effects;',
		});
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const handle = register({ tsconfig: false });
			try { console.log(JSON.stringify(await import(${JSON.stringify(pathToFileURL(`${fixture.path}/entry.ts`).href)}))); }
			finally { handle.unregister(); }
		`, fixture.path);
		expect(result).toEqual({ value: { value: 42 }, effects: 1 });
	});

	test('transforms JSON named imports with explicit import attributes', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': 'import { answer, label } from \'./data.json\' with { type: \'json\' };\nexport { answer, label };\n',
			'data.json': JSON.stringify({ answer: 42, label: 'json' }),
		});
		const entryUrl = pathToFileURL(`${fixture.path}/entry.ts`).href;
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const handle = register({ tsconfig: false });
			try { console.log(JSON.stringify(await import(${JSON.stringify(entryUrl)}))); }
			finally { handle.unregister(); }
		`, fixture.path);

		expect(result).toMatchObject({ answer: 42, label: 'json' });
	});

	test('loads virtual sources through the real hook chain', async () => {
		const virtualUrl = 'file:///virtual-load-test.ts';
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
		const handle = register({ tsconfig: false, virtualSources: new Map([[${JSON.stringify(virtualUrl)}, 'export const value = 7;']]) });
		try { console.log(JSON.stringify(await import(${JSON.stringify(virtualUrl)}))); }
		finally { handle.unregister(); }
		`, fixture.path);

		expect(result).toMatchObject({ value: 7 });
	});

	test('falls back to esbuild for decorators, enums, and namespaces', async () => {
		await using fixture = await createProjectFixture({
			'decorator.ts': 'function mark(value: any) { return value; }\n@mark\nexport class Decorated {}\n',
			'enum.ts': 'export enum Color { Red = \'red\' }\nexport const color = Color.Red;\n',
			'namespace.ts': 'export namespace Nested { export const value = 9; }\n',
			'entry.ts': '',
		});
		const urls = ['decorator.ts', 'enum.ts', 'namespace.ts'].map(name => pathToFileURL(`${fixture.path}/${name}`).href);
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const handle = register({ tsconfig: false });
			try {
				const decorator = await import(${JSON.stringify(urls[0])});
				const enumeration = await import(${JSON.stringify(urls[1])});
				const namespace = await import(${JSON.stringify(urls[2])});
				console.log(JSON.stringify({ decorated: decorator.Decorated.name, color: enumeration.color, nested: namespace.Nested.value }));
			} finally { handle.unregister(); }
		`, fixture.path);

		expect(result).toEqual({ decorated: 'Decorated', color: 'red', nested: 9 });
	});

	test('strips erasable TypeScript syntax in a real child process', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': 'const value: number = 40;\nexport const answer: number = value + 2;\n',
		});
		const entryUrl = pathToFileURL(`${fixture.path}/entry.ts`).href;
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const handle = register({ tsconfig: false });
			try { console.log(JSON.stringify(await import(${JSON.stringify(entryUrl)}))); }
			finally { handle.unregister(); }
		`, fixture.path);

		expect(result).toMatchObject({ answer: 42 });
	});

	test('normalizes onImport URLs by removing the namespace query', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'value.ts': 'export const value: number = 42;\n',
		});
		const valueUrl = pathToFileURL(`${fixture.path}/value.ts`).href;
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const loadedUrls = [];
			const handle = register({ namespace: 'load-callback', tsconfig: false, onImport: url => loadedUrls.push(url) });
			try { await import(${JSON.stringify(`${valueUrl}?tsnode-namespace=load-callback`)}); console.log(JSON.stringify(loadedUrls)); }
			finally { handle.unregister(); }
		`, fixture.path);

		expect(result).toEqual([pathToFileURL(`${fixture.path}/value.ts`).href]);
	});
});