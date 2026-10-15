import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { childEnvironment, createProjectFixture } from './utils/fixture';
import { Json } from '../src/utils/json';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceResolveHookPath = path.join(import.meta.dirname, 'utils/source-resolve-hook.ts');

const runNode = async (script: string, cwd: string, extraArgs: string[] = [], env?: Record<string, string>) => {
	const result = await execFileAsync(process.execPath, [
		'--experimental-strip-types',
		...extraArgs,
		'--import', sourceResolveHookPath,
		'--input-type=module',
		'--eval', script,
	], { cwd, env: childEnvironment(env) });

	return Json.parse(result.stdout);
};

const apiPath = (name: string) => pathToFileURL(`${projectRoot}/src/api/${name}.ts`).href;

describe('API integration', () => {
	test('built runner preserves JSONC inheritance, aliases, and malformed-config rejection', async () => {
		await execFileAsync(process.execPath, ['scripts/build/build-js.ts'], { cwd: projectRoot, env: childEnvironment() });
		await using fixture = await createProjectFixture({
			'tsconfig.json': '{ /* root */ "extends": "./base.json", }',
			'base.json': '{ /* inherited */ "compilerOptions": { "paths": { "@app/*": ["./src/*",], }, }, }',
			'entry.ts': '',
			'src/value.ts': 'export enum Answer { value = 42 }',
		});
		const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', `
			import { writeFileSync } from 'node:fs';
			import { tsImport } from ${Json.serialize(pathToFileURL(path.join(projectRoot, 'dist/api/index.js')).href)};
			const options = { parentURL: ${Json.serialize(path.join(fixture.path, 'entry.ts'))}, tsconfig: './tsconfig.json' };
			const first = await tsImport('@app/value', options);
			writeFileSync('base.json', '{ "compilerOptions": {}, broken }');
			let rejected = false;
			try { await tsImport('@app/value', options); } catch { rejected = true; }
			console.log(JSON.stringify({ value: first.Answer.value, rejected }));
		`], { cwd: fixture.path, env: childEnvironment() });
		expect(Json.parse(result.stdout)).toEqual({ value: 42, rejected: true });
	});

	test('built declarations expose OnImport through root and API package exports', async () => {
		await execFileAsync(process.execPath, ['scripts/build/build-types.ts'], { cwd: projectRoot, env: childEnvironment() });
		const ts = await import('typescript');
		const filename = path.join(projectRoot, 'on-import-consumer.mts');
		const source = `
			import type { OnImport as RootOnImport } from '@d1g1tal/tsnode';
			import type { OnImport, RegisterOptions, TsImportOptions } from '@d1g1tal/tsnode/api';
			const callback: OnImport = (url: string): void => { void url; };
			const rootCallback: RootOnImport = callback;
			const registration: RegisterOptions = { onImport: rootCallback };
			const options: TsImportOptions = { parentURL: import.meta.url, onImport: callback };
			// @ts-expect-error OnImport requires a string parameter
			const invalid: OnImport = (url: number): void => { void url; };
			void registration; void options; void invalid;
		`;
		const options = { noEmit: true, strict: true, module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ESNext };
		const host = ts.createCompilerHost(options);
		const originalGetSourceFile = host.getSourceFile.bind(host);
		host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === filename ? ts.createSourceFile(file, source, languageVersion, true) : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
		const program = ts.createProgram([filename], options, host);
		const diagnostics = ts.getPreEmitDiagnostics(program);
		expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCanonicalFileName: file => file,
			getCurrentDirectory: () => projectRoot,
			getNewLine: () => '\n',
		})).toBe('');
	});

	test.each(['unscoped', 'public', 'shared'] as const)('%s using registrations keep delayed imports alive only within their block', async (kind) => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'value.ts': 'export enum Answer { value = 42 }\nexport const child = () => import("./child.ts"); export const after = () => import("./after.ts");\n',
			'child.ts': 'export enum Child { value = 7 }\n',
			'after.ts': 'export enum After { value = 9 }\n',
		});
		const createRegistration = kind === 'unscoped' ? 'register({ tsconfig: false })' : `${kind === 'public' ? 'register' : 'registerScoped'}({ namespace: 'using-${kind}', tsconfig: false })`;
		const result = await runNode(`
			import module from 'node:module';
			import { register, registerScoped } from ${Json.serialize(apiPath('register'))};
			const nativeRegister = module.registerHooks;
			let deregistrations = 0;
			module.registerHooks = options => {
				const native = nativeRegister(options);
				return { deregister: () => { deregistrations++; native.deregister(); } };
			};
			let value, child, during, alias;
			{
				using registration = ${createRegistration};
				alias = registration[Symbol.dispose] === registration.unregister;
				value = await ${kind === 'unscoped' ? `import(${Json.serialize(pathToFileURL(`${fixture.path}/value.ts`).href)})` : `registration.import('./value.ts', ${Json.serialize(`${fixture.path}/entry.ts`)})`};
				await Promise.resolve();
				child = await value.child();
				during = deregistrations;
			}
			let code, thrown;
			try { await value.after(); } catch (error) { code = error.code; }
			try {
				using registration = ${createRegistration};
				throw new Error('using exception');
			} catch (error) { thrown = error.message; }
			console.log(JSON.stringify({ alias, value: value.Answer.value, child: child.Child.value, during, deregistrations, code, thrown }));
		`, fixture.path);
		expect(result).toEqual({ alias: true, value: 42, child: 7, during: 0, deregistrations: 2, code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX', thrown: 'using exception' });
	});

	test('virtual-source imports reuse map identity, isolate other maps and retain delayed imports', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import { tsImport } from ${Json.serialize(apiPath('index'))};
			const source = 'virtual://imports/value.js?custom=a%26b#fragment';
			const virtualSources = new Map([
				[source, 'export const value = 42; export const url = import.meta.url; export const child = () => import("./child.js");'],
				['virtual://imports/child.js', 'export const value = 7; export const url = import.meta.url;'],
			]);
			const options = { parentURL: ${Json.serialize(`${fixture.path}/entry.ts`)}, tsconfig: false, virtualSources };
			const first = await tsImport(source, options);
			const again = await tsImport(source, { ...options });
			const different = new Map(virtualSources);
			different.set(source, 'export const value = 99;');
			const other = await tsImport(source, { ...options, virtualSources: different });
			await Promise.resolve();
			const child = await first.child();
			const url = new URL(first.url);
			console.log(JSON.stringify({ same: first === again, separate: first !== other, values: [first.value, other.value, child.value], sameScope: url.searchParams.get('tsnode-namespace') === new URL(child.url).searchParams.get('tsnode-namespace'), custom: url.searchParams.get('custom'), fragment: url.hash }));
		`, fixture.path);
		expect(result).toEqual({ same: true, separate: true, values: [42, 99, 7], sameScope: true, custom: 'a&b', fragment: '#fragment' });
	});

	test.each(['register', 'registerScoped'] as const)('%s using registrations load original file and protocol virtual-source keys', async (registration) => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import { ${registration} } from ${Json.serialize(apiPath('register'))};
			const fileUrl = ${Json.serialize(pathToFileURL(`${fixture.path}/missing.js`).href)};
			const virtualSources = new Map([[fileUrl, 'export const value = 42;'], ['virtual://public/empty.js', '']]);
			let values;
			{
				using registration = ${registration}({ namespace: 'virtual-public', tsconfig: false, virtualSources });
				const file = await registration.import(fileUrl, ${Json.serialize(`${fixture.path}/entry.ts`)});
				const empty = await registration.import('virtual://public/empty.js', ${Json.serialize(`${fixture.path}/entry.ts`)});
				values = [file.value, Object.keys(empty).length];
			}
			console.log(JSON.stringify(values));
		`, fixture.path);
		expect(result).toEqual([42, 0]);
	});

	test.each(['register', 'registerScoped'] as const)('%s isolates overlapping virtual sources and delayed imports', async (registration) => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import { ${registration} } from ${Json.serialize(apiPath('register'))};
			const source = 'virtual://isolation/value.js';
			const child = 'virtual://isolation/child.js';
			using first = ${registration}({ namespace: 'provider-first', tsconfig: false, virtualSources: new Map([
				[source, 'export const value = 42; export const child = () => import("./child.js");'],
				[child, 'export const value = 7;'],
			]) });
			using second = ${registration}({ namespace: 'provider-second', tsconfig: false, virtualSources: new Map([
				[source, 'export const value = 99; export const child = () => import("./child.js");'],
				[child, 'export const value = 9;'],
			]) });
			const parent = ${Json.serialize(`${fixture.path}/entry.ts`)};
			const firstModule = await first.import(source, parent);
			const secondModule = await second.import(source, parent);
			console.log(JSON.stringify([firstModule.value, secondModule.value, (await firstModule.child()).value, (await secondModule.child()).value]));
		`, fixture.path);
		expect(result).toEqual([42, 99, 7, 9]);
	});

	test('source-map leases restore all options after the last independent or shared owner', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import module from 'node:module';
			import { register, registerScoped } from ${Json.serialize(apiPath('register'))};
			module.setSourceMapsSupport(false, { nodeModules: true, generatedCode: false });
			const before = module.getSourceMapsSupport();
			const first = register({ tsconfig: false });
			const publicScoped = register({ namespace: 'public', tsconfig: false });
			const old = registerScoped({ namespace: 'replacement', tsconfig: false });
			const current = registerScoped({ namespace: 'replacement', tsconfig: false });
			const second = registerScoped({ namespace: 'second', tsconfig: false });
			const during = module.getSourceMapsSupport();
			const stable = during === module.getSourceMapsSupport();
			old[Symbol.dispose](); old.unregister();
			first.unregister(); publicScoped[Symbol.dispose](); current.unregister();
			const remaining = module.getSourceMapsSupport();
			second[Symbol.dispose](); second.unregister();
			const after = module.getSourceMapsSupport();
			module.setSourceMapsSupport(false);
			const stale = registerScoped({ namespace: 'last-replacement', tsconfig: false });
			const replacement = registerScoped({ namespace: 'last-replacement', tsconfig: false });
			replacement.unregister();
			const replacedAfter = module.getSourceMapsSupport().enabled;
			stale.unregister();
			console.log(JSON.stringify({ before, during, stable, remaining, after, replacedAfter }));
		`, fixture.path, [], { TSNODE_SOURCE_MAPS: '1' });
		expect(result).toEqual({
			before: { enabled: false, nodeModules: true, generatedCode: false },
			during: { enabled: true, nodeModules: true, generatedCode: true },
			stable: true,
			remaining: { enabled: true, nodeModules: true, generatedCode: true },
			after: { enabled: false, nodeModules: true, generatedCode: false },
			replacedAfter: false,
		});
	});

	test.each(['module', 'process'] as const)('source-map leases preserve later external changes through %s setters', async (setter) => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import module from 'node:module';
			import { register, registerScoped } from ${Json.serialize(apiPath('register'))};
			const results = [];
			for (const enabled of [true, false]) {
				module.setSourceMapsSupport(false);
				const first = register({ tsconfig: false });
				const second = registerScoped({ namespace: 'external', tsconfig: false });
				const owned = module.getSourceMapsSupport();
				${setter === 'module' ? 'module.setSourceMapsSupport(enabled, { nodeModules: false, generatedCode: true });' : 'process.setSourceMapsEnabled(enabled);'}
				const external = module.getSourceMapsSupport();
				const changedIdentity = external !== owned;
				first.unregister(); second[Symbol.dispose](); second.unregister();
				results.push({ enabled, preserved: module.getSourceMapsSupport() === external, state: module.getSourceMapsSupport(), changedIdentity });
			}
			console.log(JSON.stringify(results));
		`, fixture.path, [], { TSNODE_SOURCE_MAPS: '1' });
		expect(result).toEqual([true, false].map(enabled => ({
			enabled, preserved: true, changedIdentity: true,
			state: { enabled, nodeModules: setter === 'process' && enabled, generatedCode: setter === 'module' || enabled },
		})));
	});

	test('already-enabled custom source-map options are never changed', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import module from 'node:module';
			import { register, registerScoped } from ${Json.serialize(apiPath('register'))};
			module.setSourceMapsSupport(true, { nodeModules: false, generatedCode: false });
			const external = module.getSourceMapsSupport();
			const first = register({ tsconfig: false });
			const second = registerScoped({ namespace: 'external-enabled', tsconfig: false });
			const during = module.getSourceMapsSupport() === external;
			second.unregister(); first[Symbol.dispose]();
			console.log(JSON.stringify({ during, after: module.getSourceMapsSupport() === external, state: module.getSourceMapsSupport() }));
		`, fixture.path, [], { TSNODE_SOURCE_MAPS: '1' });
		expect(result).toEqual({ during: true, after: true, state: { enabled: true, nodeModules: false, generatedCode: false } });
	});

	test('new source-map ownership after an external change survives old lease cleanup', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import module from 'node:module';
			import { register, registerScoped } from ${Json.serialize(apiPath('register'))};
			module.setSourceMapsSupport(false);
			const old = registerScoped({ namespace: 'old-owner', tsconfig: false });
			module.setSourceMapsSupport(false, { nodeModules: false, generatedCode: true });
			const before = module.getSourceMapsSupport();
			const current = register({ tsconfig: false });
			const owned = module.getSourceMapsSupport();
			old.unregister();
			const preserved = module.getSourceMapsSupport() === owned;
			current[Symbol.dispose]();
			console.log(JSON.stringify({ preserved, before, after: module.getSourceMapsSupport() }));
		`, fixture.path, [], { TSNODE_SOURCE_MAPS: '1' });
		expect(result).toEqual({ preserved: true, before: { enabled: false, nodeModules: false, generatedCode: true }, after: { enabled: false, nodeModules: false, generatedCode: true } });
	});

	test.each(['register', 'registerScoped'] as const)('%s registration failure releases its source-map lease', async (registration) => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import module from 'node:module';
			import { ${registration} } from ${Json.serialize(apiPath('register'))};
			module.setSourceMapsSupport(false, { nodeModules: true, generatedCode: false });
			const before = module.getSourceMapsSupport();
			module.registerHooks = () => { throw new Error('registration failed'); };
			let message;
			try { ${registration}({ namespace: 'failure', tsconfig: false }); } catch (error) { message = error.message; }
			console.log(JSON.stringify({ message, before, after: module.getSourceMapsSupport() }));
		`, fixture.path, [], { TSNODE_SOURCE_MAPS: '1' });
		expect(result).toEqual({ message: 'registration failed', before: { enabled: false, nodeModules: true, generatedCode: false }, after: { enabled: false, nodeModules: true, generatedCode: false } });
	});

	test('repeated equivalent imports share module identity and retain delayed child imports', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'value.ts': 'export enum Answer { value = 42 }\nexport const url = import.meta.url; export const child = () => import("./child.ts");\n',
			'child.ts': 'export enum Child { value = 7 }\nexport const url = import.meta.url;\n',
		});
		const result = await runNode(`
			import { tsImport } from ${Json.serialize(apiPath('index'))};
			const options = { parentURL: ${Json.serialize(`${fixture.path}/entry.ts`)}, tsconfig: false };
			const modules = await Promise.all(Array.from({ length: 20 }, () => tsImport('./value.ts', options)));
			await Promise.resolve();
			const child = await modules[0].child();
			const again = await tsImport('./value.ts', { ...options });
			console.log(JSON.stringify({ same: modules.every(value => value === again), value: again.Answer.value, child: child.Child.value, sameScope: new URL(again.url).search === new URL(child.url).search }));
		`, fixture.path);
		expect(result).toEqual({ same: true, value: 42, child: 7, sameScope: true });
	});

	test('reuses normalized config selections but isolates different configs and changed content', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'value.ts': 'export enum Answer { value = 42 }\n',
			'other.json': Json.serialize({ compilerOptions: { target: 'esnext' } })!,
		});
		const result = await runNode(`
			import { tsImport } from ${Json.serialize(apiPath('index'))};
			import { writeFileSync } from 'node:fs';
			delete process.env['TSNODE_TSCONFIG_PATH'];
			const parentURL = ${Json.serialize(`${fixture.path}/entry.ts`)};
			const first = await tsImport('./value.ts', { parentURL, tsconfig: './tsconfig.json' });
			const absolute = await tsImport('./value.ts', { parentURL, tsconfig: ${Json.serialize(`${fixture.path}/tsconfig.json`)} });
			const automatic = await tsImport('./value.ts', parentURL);
			const disabled = await tsImport('./value.ts', { parentURL, tsconfig: false });
			const other = await tsImport('./value.ts', { parentURL, tsconfig: './other.json' });
			writeFileSync('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2022' } }));
			const changed = await tsImport('./value.ts', { parentURL, tsconfig: './tsconfig.json' });
			console.log(JSON.stringify({ equivalent: first === absolute && first === automatic, disabled: first !== disabled, other: first !== other, changed: first !== changed }));
		`, fixture.path);
		expect(result).toEqual({ equivalent: true, disabled: true, other: true, changed: true });
	});

	test('callback identity separates scopes without reloading equivalent callback imports', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '', 'value.ts': 'export enum Value { answer = 42 }\n' });
		const result = await runNode(`
			import { tsImport } from ${Json.serialize(apiPath('index'))};
			const firstLoads = [], secondLoads = [];
			const firstCallback = url => firstLoads.push(url);
			const secondCallback = url => secondLoads.push(url);
			const parentURL = ${Json.serialize(`${fixture.path}/entry.ts`)};
			const first = await tsImport('./value.ts', { parentURL, tsconfig: false, onImport: firstCallback });
			const again = await tsImport('./value.ts', { parentURL, tsconfig: false, onImport: firstCallback });
			const second = await tsImport('./value.ts', { parentURL, tsconfig: false, onImport: secondCallback });
			console.log(JSON.stringify({ same: first === again, separate: first !== second, counts: [firstLoads.length, secondLoads.length], clean: [...firstLoads, ...secondLoads].every(url => !url.includes('tsnode-namespace')) }));
		`, fixture.path);
		expect(result).toEqual({ same: true, separate: true, counts: [1, 1], clean: true });
	});

	test('failed real imports release new scopes while concurrent success retains its scope', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'failure.ts': 'export enum Failure { value = 1 }\nthrow new Error("evaluation failed");\n',
			'value.ts': 'export const child = () => import("./child.ts");\n',
			'child.ts': 'export enum Answer { value = 42 }\n',
		});
		const result = await runNode(`
			import { tsImport } from ${Json.serialize(apiPath('index'))};
			import module from 'node:module';
			const nativeRegister = module.registerHooks;
			let registrations = 0, deregistrations = 0;
			module.registerHooks = options => {
				registrations++;
				const handle = nativeRegister(options);
				return { deregister: () => { deregistrations++; handle.deregister(); } };
			};
			const options = { parentURL: ${Json.serialize(`${fixture.path}/entry.ts`)}, tsconfig: false };
			for (let index = 0; index < 10; index++) { try { await tsImport(index % 2 === 0 ? './missing.ts' : './failure.ts', options); } catch {} }
			const allFailed = await Promise.allSettled([tsImport('./missing-first.ts', options), tsImport('./missing-second.ts', options)]);
			const mixed = await Promise.allSettled([tsImport('./missing-third.ts', options), tsImport('./value.ts', options)]);
			const value = mixed[1].value;
			const child = await value.child();
			const again = await tsImport('./value.ts', options);
			console.log(JSON.stringify({ registrations, deregistrations, allFailed: allFailed.every(result => result.status === 'rejected'), failed: mixed[0].status, same: value === again, child: child.Answer.value }));
		`, fixture.path);
		expect(result).toEqual({ registrations: 12, deregistrations: 11, allFailed: true, failed: 'rejected', same: true, child: 42 });
	});

	test('imports root builtins and data URLs without namespace queries', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import { tsImport, register } from ${Json.serialize(apiPath('index'))};
			const parentURL = ${Json.serialize(`${fixture.path}/entry.ts`)};
			const expected = await import('node:fs');
			const builtin = await tsImport('node:fs', parentURL);
			const bare = await tsImport('fs', parentURL);
			const source = 'data:text/javascript,' + encodeURIComponent('export default "?&#%unicode"');
			const data = await tsImport(source, parentURL);
			const handle = register({ namespace: 'builtin-public', tsconfig: false });
			try {
				const publicBuiltin = await handle.import('node:fs', parentURL);
				console.log(JSON.stringify({ builtin: builtin === expected && bare === expected && publicBuiltin === expected, data: data.default }));
			} finally { handle.unregister(); }
		`, fixture.path);
		expect(result).toEqual({ builtin: true, data: '?&#%unicode' });
	});

	test.each(['register', 'registerScoped'])('supports delimiter namespaces and fragments through %s', async (registration) => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'value.ts': 'export enum Answer { value = 42 }\nexport const url = import.meta.url; export const child = () => import("./child.ts");\n',
			'child.ts': 'export enum Child { value = 7 }\nexport const url = import.meta.url;\n',
		});
		const namespace = 'scope&fragment#percent%unicode-\u4f60\u597d? +';
		const result = await runNode(`
			import { ${registration} } from ${Json.serialize(apiPath('register'))};
			const namespace = ${Json.serialize(namespace)};
			const handle = ${registration}({ namespace, tsconfig: false });
			try {
				const value = await handle.import('./value.ts?custom=a%26b#fragment', ${Json.serialize(`${fixture.path}/entry.ts`)});
				const child = await value.child();
				const url = new URL(value.url);
				console.log(JSON.stringify({ namespace: url.searchParams.get('tsnode-namespace'), fragment: url.hash, custom: url.searchParams.get('custom'), childNamespace: new URL(child.url).searchParams.get('tsnode-namespace'), child: child.Child.value }));
			} finally { handle.unregister(); }
		`, fixture.path);
		expect(result).toEqual({ namespace, fragment: '#fragment', custom: 'a&b', childNamespace: namespace, child: 7 });
	});

	test('stale scoped handles cannot unregister a namespace replacement', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '', 'value.ts': 'export enum Answer { value = 42 }\n' });
		const result = await runNode(`
			import { registerScoped } from ${Json.serialize(apiPath('register'))};
			const oldLoads = [], newLoads = [];
			const old = registerScoped({ namespace: 'replacement', tsconfig: false, onImport: url => oldLoads.push(url) });
			const current = registerScoped({ namespace: 'replacement', tsconfig: false, onImport: url => newLoads.push(url) });
			old.unregister(); old.unregister();
			const value = await current.import('./value.ts', ${Json.serialize(`${fixture.path}/entry.ts`)});
			current.unregister(); current.unregister();
			let code;
			try { await import(${Json.serialize(pathToFileURL(`${fixture.path}/value.ts`).href + '?after-replacement')}); } catch (error) { code = error.code; }
			console.log(JSON.stringify({ value: value.Answer.value, counts: [oldLoads.length, newLoads.length], code }));
		`, fixture.path);
		expect(result).toEqual({ value: 42, counts: [0, 1], code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' });
	});

	test('imports TypeScript with a normalized string parent path', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': '',
			'value.ts': 'export const value: number = 42;\n',
		});
		const parentPath = `${fixture.path}/entry.ts`;
		const result = await runNode(`
			import { registerScoped } from ${Json.serialize(apiPath('register'))};
			const handle = registerScoped({ namespace: 'string-parent', tsconfig: false });
			try {
				const module = await handle.import('./value.ts', ${Json.serialize(parentPath)});
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
			import { tsImport } from ${Json.serialize(apiPath('index'))};
			const values = await Promise.all([
				tsImport('./first.ts', ${Json.serialize(parentUrl)}),
				tsImport('./second.ts', ${Json.serialize(parentUrl)}),
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
			'first-tsconfig.json': Json.serialize({ compilerOptions: { target: 'esnext', module: 'esnext', baseUrl: '.', paths: { '@value': ['./first.ts'] } } })!,
			'second-tsconfig.json': Json.serialize({ compilerOptions: { target: 'esnext', module: 'esnext', baseUrl: '.', paths: { '@value': ['./second.ts'] } } })!,
		});
		const parentPath = `${fixture.path}/entry.ts`;
		const result = await runNode(`
			import { registerScoped } from ${Json.serialize(apiPath('register'))};
			const first = registerScoped({ namespace: 'first-config', tsconfig: ${Json.serialize(`${fixture.path}/first-tsconfig.json`)} });
			const second = registerScoped({ namespace: 'second-config', tsconfig: ${Json.serialize(`${fixture.path}/second-tsconfig.json`)} });
			try {
				const values = await Promise.all([
					first.import('@value', ${Json.serialize(parentPath)}),
					second.import('@value', ${Json.serialize(parentPath)}),
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
			import { registerScoped } from ${Json.serialize(apiPath('register'))};
			const first = registerScoped({ namespace: 'first', tsconfig: false });
			const second = registerScoped({ namespace: 'second', tsconfig: false });
			const loaded = await first.import(${Json.serialize(enumUrl)}, ${Json.serialize(`${fixture.path}/entry.ts`)});
			first.unregister();
			const stillLoaded = await second.import(${Json.serialize(`${enumUrl}?second`)}, ${Json.serialize(`${fixture.path}/entry.ts`)});
			second.unregister();
			let errorCode;
			try { await import(${Json.serialize(`${enumUrl}?after-unregister`)}); } catch (error) { errorCode = error.code; }
			console.log(JSON.stringify({ value: loaded.Answer.value, stillLoaded: stillLoaded.Answer.value, errorCode }));
		`, fixture.path);

		expect(result).toEqual({ value: 42, stillLoaded: 42, errorCode: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' });
	});

	test('preserves externally enabled source maps after unregister', async () => {
		await using fixture = await createProjectFixture({ 'entry.ts': '' });
		const result = await runNode(`
			import { register } from ${Json.serialize(apiPath('register'))};
			const before = process.sourceMapsEnabled;
			const handle = register({ tsconfig: false });
			const during = process.sourceMapsEnabled;
			handle.unregister();
			console.log(JSON.stringify({ before, during, after: process.sourceMapsEnabled }));
		`, fixture.path, ['--enable-source-maps']);

		expect(result).toEqual({ before: true, during: true, after: true });
	});

});