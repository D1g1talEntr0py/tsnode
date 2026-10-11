import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createData } from '../src/hook/initialize';
import { createResolveSync } from '../src/hook/resolve';
import { namespaceQuery, getNamespace } from '../src/hook/utils';
import { childEnvironment, createProjectFixture } from './utils/fixture';

describe('hook resolve', () => {
	test('does not parse tsconfig until an alias needs it', async () => {
		await using fixture = await createProjectFixture({
			'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@app/*': ['./*'], 'ns:foo': ['./typed.ts'] } } }),
			'main.ts': '',
			'child.js': 'export const value = 1;',
			'typed.ts': 'export const value: number = 2;',
		});
		const parentURL = pathToFileURL(path.join(fixture.path, 'main.ts')).href;
		const result = spawnSync(process.execPath, [
			'--experimental-strip-types',
			'--import', new URL('./utils/source-resolve-hook.ts', import.meta.url).href,
			'--input-type=module', '--eval', `
				import { createRequire, registerHooks } from 'node:module';
				import { createData } from ${JSON.stringify(new URL('../src/hook/initialize.ts', import.meta.url).href)};
				import { createResolveSync } from ${JSON.stringify(new URL('../src/hook/resolve.ts', import.meta.url).href)};
				const require = createRequire(import.meta.url);
				const resolverLoaded = () => Object.keys(require.cache).some(entry => entry.includes('/src/utils/tsconfig-parser/'));
				const before = resolverLoaded();
				const data = createData({ tsconfig: ${JSON.stringify(path.join(fixture.path, 'tsconfig.json'))} });
				const resolve = createResolveSync(data);
				const hook = registerHooks({
					resolve(specifier, context, nextResolve) {
						return context.parentURL === import.meta.url ? resolve(specifier, { ...context, parentURL: ${JSON.stringify(parentURL)} }, nextResolve) : nextResolve(specifier, context);
					},
				});
				const resolveRequest = (specifier) => {
					const url = import.meta.resolve(specifier);
					return { url, loaded: data.hasLoadedTsconfig, parsed: data.parsedTsconfig !== undefined, resolverLoaded: resolverLoaded() };
				};
				const files = ['./child.js', './child', './typed.js', './typed'].map(resolveRequest);
				const aliases = ['@app/typed', 'ns:foo'].map(resolveRequest);
				hook.deregister();
				console.log(JSON.stringify({ before, files, aliases }));
			`,
		], { cwd: fixture.path, env: childEnvironment(), encoding: 'utf-8' });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toBe('');
		expect(JSON.parse(result.stdout)).toEqual({
			before: false,
			files: ['child.js', 'child.js', 'typed.ts', 'typed.ts'].map(file => ({
				url: pathToFileURL(path.join(fixture.path, file)).href,
				loaded: false,
				parsed: false,
				resolverLoaded: false,
			})),
			aliases: ['@app/typed', 'ns:foo'].map(() => ({
				url: pathToFileURL(path.join(fixture.path, 'typed.ts')).href,
				loaded: true,
				parsed: true,
				resolverLoaded: false,
			})),
		});
	});

	test.each([true, false])('demands config for JavaScript-parent fallback with allowJs=%s', async (allowJs) => {
		await using fixture = await createProjectFixture({
			'tsconfig.json': JSON.stringify({ compilerOptions: { allowJs } }),
		});
		const data = createData({ tsconfig: path.join(fixture.path, 'tsconfig.json') });
		const resolve = createResolveSync(data);
		const context = { conditions: ['node', 'import'], importAttributes: {}, parentURL: 'file:///project/main.js' };
		const resolutionError = Object.assign(new Error('missing'), { code: 'ERR_MODULE_NOT_FOUND' });
		const calls: string[] = [];
		const nextResolve = (specifier: string) => {
			calls.push(specifier);
			if (specifier === './child.ts') { return { url: 'file:///project/child.ts', format: 'module-typescript', shortCircuit: true } }
			throw resolutionError;
		};

		if (allowJs) {
			expect(resolve('./child.js', context, nextResolve)).toMatchObject({ url: 'file:///project/child.ts', format: 'module' });
			expect(calls).toEqual(['./child.js', './child.ts']);
		} else {
			let caught: unknown;
			try { resolve('./child.js', context, nextResolve) } catch (error) { caught = error }
			expect(caught).toBe(resolutionError);
			expect(calls).toEqual(['./child.js', './child.js']);
		}
		expect(data.hasLoadedTsconfig).toBe(true);
		expect(data.parsedTsconfig?.compilerOptions.allowJs).toBe(allowJs);
	});

	test('does not initialize aliases for dependency parents', async () => {
		await using fixture = await createProjectFixture({
			'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@app/*': ['./src/*'] } } }),
		});
		const data = createData({ tsconfig: path.join(fixture.path, 'tsconfig.json') });
		const resolve = createResolveSync(data);
		const context = { conditions: ['node', 'import'], importAttributes: {}, parentURL: 'file:///project/node_modules/package/main.ts' };
		const calls: string[] = [];
		const resolved = { url: 'file:///project/node_modules/@app/value.js', format: 'module', shortCircuit: true };
		expect(resolve('@app/value', context, specifier => {
			calls.push(specifier);
			return resolved;
		})).toBe(resolved);
		expect(calls).toEqual(['@app/value']);
		expect(data.hasLoadedTsconfig).toBe(false);
		expect(data.parsedTsconfig).toBeUndefined();
	});

	test('encodes delimiter namespaces, decodes them for children, and preserves fragments without loading config', async () => {
		await using fixture = await createProjectFixture({});
		const namespace = 'scope&fragment#percent%unicode-\u4f60\u597d? +';
		const data = createData({ namespace, tsconfig: path.join(fixture.path, 'tsconfig.json') });
		const resolve = createResolveSync(data);
		const context = { conditions: ['node', 'import'], importAttributes: {}, parentURL: 'file:///project/main.ts' };
		const url = resolve(`tsnode://${JSON.stringify({ namespace, specifier: './entry.ts?custom=a%26b#fragment', parentURL: context.parentURL })}`, context, (specifier) => ({ url: new URL(specifier, context.parentURL).href, format: 'module', shortCircuit: true })).url;
		expect(getNamespace(url)).toBe(namespace);
		expect(new URL(url).hash).toBe('#fragment');
		expect(new URL(url).searchParams.get('custom')).toBe('a&b');
		const child = resolve('./child.ts', { ...context, parentURL: url }, () => ({ url: 'file:///project/child.ts', format: 'module', shortCircuit: true }));
		expect(getNamespace(child.url)).toBe(namespace);
		expect(getNamespace('file:///entry.ts#fragment?tsnode-namespace=wrong')).toBeUndefined();
		expect(data.hasLoadedTsconfig).toBe(false);
		expect(data.parsedTsconfig).toBeUndefined();
	});

	test.each(['node:fs', 'fs', 'data:text/javascript,export default "?value"'])('delegates root builtin/data requests unchanged: %s', (specifier) => {
		const namespace = 'protocols';
		const resolve = createResolveSync(createData({ namespace, tsconfig: false }));
		const context = { conditions: ['node', 'import'], importAttributes: {}, parentURL: 'file:///outer.ts' };
		let received = '';
		const result = resolve(`tsnode://${JSON.stringify({ namespace, specifier, parentURL: 'file:///project/main.ts' })}`, context, (nextSpecifier, nextContext) => {
			received = nextSpecifier;
			expect(nextContext?.conditions).toBe(context.conditions);
			expect(nextContext?.importAttributes).toBe(context.importAttributes);
			expect(nextContext?.parentURL).toBe('file:///project/main.ts');
			return { url: specifier === 'fs' ? 'node:fs' : specifier, shortCircuit: true };
		});
		expect(received).toBe(specifier);
		expect(result.url).toBe(specifier === 'fs' ? 'node:fs' : specifier);
	});

	test('resolves tsnode protocol requests within the active namespace', () => {
		const resolve = createResolveSync(createData({ namespace: 'bench', tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
			parentURL: 'file:///outer/parent.ts',
		} as never;

		let receivedSpecifier = '';
		let receivedParentURL = '';

		const result = resolve(
			'tsnode://{"specifier":"./entry.ts","parentURL":"file:///project/main.ts","namespace":"bench"}',
			context,
			(specifier, nextContext) => {
				receivedSpecifier = specifier;
				receivedParentURL = nextContext!.parentURL!;

				return {
					url: 'file:///project/entry.ts',
					format: 'module-typescript',
					importAttributes: {},
					shortCircuit: true,
				};
			},
		);

		expect(receivedSpecifier).toBe('./entry.ts');
		expect(receivedParentURL).toBe('file:///project/main.ts');
		expect(result.url).toBe(`file:///project/entry.ts?${namespaceQuery}bench`);
		expect(result.format).toBe('module');
	});

	test('falls through when the request namespace does not match', () => {
		const resolve = createResolveSync(createData({ namespace: 'bench', tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
			parentURL: 'file:///outer/parent.ts',
		} as never;

		let receivedSpecifier = '';

		resolve(
			'tsnode://{"specifier":"./entry.ts","parentURL":"file:///project/main.ts","namespace":"other"}',
			context,
			(specifier) => {
				receivedSpecifier = specifier;

				return {
					url: 'file:///ignored.ts',
					format: 'module',
					importAttributes: {},
					shortCircuit: true,
				};
			},
		);

		expect(receivedSpecifier).toBe('tsnode://{"specifier":"./entry.ts","parentURL":"file:///project/main.ts","namespace":"other"}');
	});

	test.each([
		'tsnode://null',
		'tsnode://[]',
		'tsnode://{"namespace":"bench","specifier":"./entry.ts"}',
		'tsnode://{"namespace":"bench","specifier":42,"parentURL":"file:///project/main.ts"}',
		'tsnode://{"namespace":"bench","specifier":"./entry.ts","parentURL":42}',
	])('falls through for an invalid protocol payload: %s', (protocolSpecifier) => {
		const resolve = createResolveSync(createData({ namespace: 'bench', tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
			parentURL: 'file:///outer/parent.ts',
		} as never;

		let receivedSpecifier = '';
		resolve(protocolSpecifier, context, (specifier) => {
			receivedSpecifier = specifier;

			return {
				url: 'file:///delegated.ts',
				format: 'module',
				importAttributes: {},
				shortCircuit: true,
			};
		});

		expect(receivedSpecifier).toBe(protocolSpecifier);
	});

	test('preserves Error identity after the direct runtime fallback', () => {
		const resolve = createResolveSync(createData({ tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
			parentURL: 'file:///project/parent.js',
		} as never;
		const resolutionError = Object.assign(new Error('missing'), { code: 'ERR_MODULE_NOT_FOUND' });
		let calls = 0;

		let caught: unknown;
		try {
			resolve('./missing.js', context, () => {
				calls += 1;
				throw resolutionError;
			});
		} catch (error) {
			caught = error;
		}

		expect(calls).toBeGreaterThan(1);
		expect(caught).toBe(resolutionError);
	});

	test('rethrows non-Error values unchanged', () => {
		const resolve = createResolveSync(createData({ tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
			parentURL: 'file:///project/parent.js',
		} as never;
		const thrownValue = { reason: 'custom resolver failure' };

		let caught: unknown;
		try {
			resolve('./missing.js', context, () => { throw thrownValue });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(thrownValue);
	});

	test('preserves non-Error identity after directory extension fallbacks', () => {
		const resolve = createResolveSync(createData({ tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
			parentURL: 'file:///project/parent.js',
		} as never;
		const thrownValue = { code: 'ERR_MODULE_NOT_FOUND', reason: 'custom resolver failure' };

		let caught: unknown;
		try {
			resolve('./missing/', context, () => { throw thrownValue });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(thrownValue);
	});

	test('resolves without a parent URL', () => {
		const resolve = createResolveSync(createData({ tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
		} as never;

		const result = resolve('./entry.js', context, () => ({
			url: 'file:///project/entry.js',
			format: 'module',
			importAttributes: {},
			shortCircuit: true,
		}));

		expect(result.url).toBe('file:///project/entry.js');
	});

	test('preserves index resolution Error identity when cleaning its message', () => {
		const resolve = createResolveSync(createData({ tsconfig: false }));
		const context = {
			conditions: ['node', 'import'],
			importAttributes: {},
			parentURL: 'file:///project/parent.js',
		} as never;
		const directoryError = Object.assign(new Error('Directory import'), {
			code: 'ERR_UNSUPPORTED_DIR_IMPORT',
			url: 'file:///project/folder',
		});
		const indexError = Object.assign(new Error("Cannot find module '/project/folder/index'"), {
			code: 'ERR_MODULE_NOT_FOUND',
			stack: undefined,
		});
		let calls = 0;

		let caught: unknown;
		try {
			resolve('./folder', context, () => {
				calls += 1;
				throw calls === 1 ? directoryError : indexError;
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(indexError);
		expect(indexError.message).toBe("Cannot find module '/project/folder'");
	});
});