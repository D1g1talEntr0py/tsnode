import { describe, expect, test } from 'vitest';
import { transformSync, stripTypes } from '../src/utils/transform/index';

const base64Module = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

describe('transform index', () => {
	test('stripTypes removes type syntax and keeps runtime behavior', async () => {
		const source = 'const value: number = 1; export default value;';
		const stripped = stripTypes(source);

		expect(stripped.code).not.toContain(': number');
		const imported = await import(base64Module(stripped.code));
		expect(imported.default).toBe(1);
	});

	test('stripTypes uses cache for identical source text', () => {
		const source = 'const value: number = 2; export default value;';
		const first = stripTypes(source);
		const second = stripTypes(source);

		expect(first).toBe(second);
	});

	test('transformSync caches identical transform requests', () => {
		const source = 'export const value: number = 3;';
		const first = transformSync(source, 'cache-hit.ts');
		const second = transformSync(source, 'cache-hit.ts');

		expect(first).toBe(second);
		expect(first.code).toContain('value');
	});

	test('transformSync skips tsconfig loading on warm cache hits when a cache key is provided', () => {
		const source = 'enum Color { Red = "red" } export const color = Color.Red;';
		const filePath = 'complex-cache-hit.ts';
		transformSync(source, filePath, { tsconfigHash: 'test-tsconfig-key' });

		let tsconfigLoads = 0;
		const options = {
			tsconfigHash: 'test-tsconfig-key',
			getTsconfigRaw: () => {
				tsconfigLoads += 1;
				return undefined;
			},
		};

		transformSync(source, filePath, options);
		transformSync(source, filePath, options);

		expect(tsconfigLoads).toBe(0);
	});

	test('transformSync returns executable esm output', async () => {
		const source = 'export const value: number = 4; export default value;';
		const transformed = transformSync(source, 'esm.ts', { format: 'esm' });

		const imported = await import(base64Module(transformed.code));
		expect(imported.default).toBe(4);
		expect(imported.value).toBe(4);
	});

	test('transformSync throws formatted transform errors', () => {
		let thrown: unknown;

		try {
			transformSync('const = 1;', 'invalid.ts');
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeDefined();
		expect(thrown).toMatchObject({ name: 'TransformError' });
		expect(thrown).not.toHaveProperty('errors');
		expect(thrown).not.toHaveProperty('warnings');
	});
});