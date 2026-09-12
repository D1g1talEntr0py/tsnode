import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createProjectFixture } from './utils/fixture';

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
	], { cwd, env: { ...process.env, ...env } });

	return JSON.parse(result.stdout);
};

describe('load hook integration', () => {
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