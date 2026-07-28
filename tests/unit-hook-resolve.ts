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
});