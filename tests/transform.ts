import { describe, test, expect } from 'vitest';
import outdent from './utils/outdent';
import { transformSync } from '../src/utils/transform/index';

const base64Module = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

const fixtures = {
	ts: outdent`
	const __filename = 'filename';
	const __dirname = 'dirname';
	try {
		const unusedVariable1 = 1;
	} catch (unusedError) {
		const unusedVariable2 = 2;
	}
	export default 'default value' as string;
	export const named: string = 'named';
	export const functionName: string = (function named() {}).name;
	export const url = import.meta.url;
	`,
};

describe('transform', () => {
	describe('sync', () => {
		test('transforms TS to ESM', async () => {
			const transformed = transformSync(
				fixtures.ts,
				'file.ts',
				{ format: 'esm' },
			);

			// For debuggers
			expect(transformed.code).toMatch('unusedVariable1');
			expect(transformed.code).toMatch('unusedVariable2');

			const imported = await import(base64Module(transformed.code));
			expect({ ...imported }).toStrictEqual({
				default: 'default value',
				functionName: 'named',
				named: 'named',
				url: expect.stringMatching(/^data:text\/javascript;base64,.+$/),
			});
		});

		test('sourcemap file', () => {
			const fileName = 'file.ts';
			const transformed = transformSync(
				fixtures.ts,
				fileName,
				{ sourcemap: true },
			);

			expect(transformed.map).not.toBe('');

			const { map } = transformed;
			if (typeof map !== 'string') {
				expect(map.sources.length).toBe(1);
				expect(map.sources[0]).toBe(fileName);
				expect(map.names).toStrictEqual(['named']);
			}
		});

		test('quotes in file path', () => {
			const fileName = '\'"name.ts';
			const transformed = transformSync(
				fixtures.ts,
				fileName,
				{ sourcemap: true },
			);

			expect(transformed.map).not.toBe('');

			const { map } = transformed;
			if (typeof map !== 'string') {
				expect(map.sources.length).toBe(1);
				expect(map.sources[0]).toBe(fileName);
				expect(map.names).toStrictEqual(['named']);
			}
		});
	});
});
