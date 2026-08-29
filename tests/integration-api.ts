import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createProjectFixture } from './utils/fixture';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceResolveHookPath = fileURLToPath(new URL('./utils/source-resolve-hook.ts', import.meta.url));

const runNode = async (script: string, cwd: string, extraArgs: string[] = [], env?: Record<string, string>) => {
	const result = await execFileAsync(process.execPath, [
		'--experimental-strip-types',
		...extraArgs,
		'--import', sourceResolveHookPath,
		'--input-type=module',
		'--eval', script,
	], { cwd, env: { ...process.env, ...env } });

	return JSON.parse(result.stdout);
};

const apiPath = (name: string) => pathToFileURL(`${projectRoot}/src/api/${name}.ts`).href;

describe('API integration', () => {
	test('imports TypeScript with a normalized string parent path', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'value.ts': 'export const value: number = 42;\n',
		});
		const parentPath = `${fixture.path}/entry.ts`;
		const result = await runNode(`
			import { registerScoped } from ${JSON.stringify(apiPath('register'))};
			const handle = registerScoped({ namespace: 'string-parent', tsconfig: false });
			try {
				const module = await handle.import('./value.ts', ${JSON.stringify(parentPath)});
				console.log(JSON.stringify({ value: module.value }));
			} finally { handle.unregister(); }
		`, fixture.path);

		expect(result).toEqual({ value: 42 });
	});

	test('keeps concurrent scoped imports isolated', async () => {
		await using fixture = await createProjectFixture({
			'first.ts': 'export const value: number = 1;\n',
			'second.ts': 'export const value: number = 2;\n',
			'entry.ts': '',
		});
		const parentUrl = pathToFileURL(`${fixture.path}/entry.ts`).href;
		const result = await runNode(`
			import { tsImport } from ${JSON.stringify(apiPath('index'))};
			const values = await Promise.all([
				tsImport('./first.ts', ${JSON.stringify(parentUrl)}),
				tsImport('./second.ts', ${JSON.stringify(parentUrl)}),
			]);
			console.log(JSON.stringify(values.map((module) => module.value)));
		`, fixture.path);

		expect(result).toEqual([1, 2]);
	});

	test('keeps tsconfig path aliases isolated per scope', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'first.ts': 'export const value = "first";\n',
			'second.ts': 'export const value = "second";\n',
			'first-tsconfig.json': JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', baseUrl: '.', paths: { '@value': ['./first.ts'] } } }),
			'second-tsconfig.json': JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', baseUrl: '.', paths: { '@value': ['./second.ts'] } } }),
		});
		const parentPath = `${fixture.path}/entry.ts`;
		const result = await runNode(`
			import { registerScoped } from ${JSON.stringify(apiPath('register'))};
			const first = registerScoped({ namespace: 'first-config', tsconfig: ${JSON.stringify(`${fixture.path}/first-tsconfig.json`)} });
			const second = registerScoped({ namespace: 'second-config', tsconfig: ${JSON.stringify(`${fixture.path}/second-tsconfig.json`)} });
			try {
				const values = await Promise.all([
					first.import('@value', ${JSON.stringify(parentPath)}),
					second.import('@value', ${JSON.stringify(parentPath)}),
				]);
				console.log(JSON.stringify(values.map((module) => module.value)));
			} finally { first.unregister(); second.unregister(); }
		`, fixture.path);

		expect(result).toEqual(['first', 'second']);
	});

	test('keeps the last scoped registration alive until it unregisters', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'enum.ts': 'export enum Answer { value = 42 }\n',
		});
		const enumUrl = pathToFileURL(`${fixture.path}/enum.ts`).href;
		const result = await runNode(`
			import { registerScoped } from ${JSON.stringify(apiPath('register'))};
			const first = registerScoped({ namespace: 'first', tsconfig: false });
			const second = registerScoped({ namespace: 'second', tsconfig: false });
			const loaded = await first.import(${JSON.stringify(enumUrl)}, ${JSON.stringify(`${fixture.path}/entry.ts`)});
			first.unregister();
			const stillLoaded = await second.import(${JSON.stringify(`${enumUrl}?second`)}, ${JSON.stringify(`${fixture.path}/entry.ts`)});
			second.unregister();
			let errorCode;
			try { await import(${JSON.stringify(`${enumUrl}?after-unregister`)}); } catch (error) { errorCode = error.code; }
			console.log(JSON.stringify({ value: loaded.Answer.value, stillLoaded: stillLoaded.Answer.value, errorCode }));
		`, fixture.path);

		expect(result).toEqual({ value: 42, stillLoaded: 42, errorCode: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' });
	});

	test('restores source maps after the last unscoped registration is removed', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import { register } from ${JSON.stringify(apiPath('register'))};
			const before = process.sourceMapsEnabled;
			const handle = register({ tsconfig: false });
			const during = process.sourceMapsEnabled;
			handle.unregister();
			console.log(JSON.stringify({ before, during, after: process.sourceMapsEnabled }));
		`, fixture.path, ['--enable-source-maps']);

		expect(result).toEqual({ before: true, during: true, after: true });
	});
});