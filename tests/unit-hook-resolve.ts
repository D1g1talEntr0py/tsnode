import { describe, expect, test } from 'vitest';
import { createData } from '../src/hook/initialize';
import { createResolveSync } from '../src/hook/resolve';
import { namespaceQuery } from '../src/hook/utils';

describe('hook resolve', () => {
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
				receivedParentURL = nextContext.parentURL!;

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