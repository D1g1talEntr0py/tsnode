import { describe, expect, test, vi } from 'vitest';
import { transformSync, stripTypes } from '../src/utils/transform/index';
import cache from '../src/utils/transform/cache';

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

	test('transformSync resolves tsconfig contents on warm cache hits even with a config identity', () => {
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

		expect(tsconfigLoads).toBe(2);
	});

	test('stripTypes distinguishes sources that collided under FNV', () => {
		const lookup = vi.spyOn(cache, 'get');
		try {
			expect(stripTypes('costarring;').code).toBe('costarring;');
			expect(stripTypes('liquid;').code).toBe('liquid;');
			expect(stripTypes('costarring;').code).toBe('costarring;');
			expect(new Set(lookup.mock.calls.map(([key]) => key)).size).toBe(1);
		} finally { lookup.mockRestore() }
	});

	test('transformSync verifies colliding buckets after disk publication', async () => {
		const lookup = vi.spyOn(cache, 'get');
		try {
			expect(transformSync('costarring;', 'collision.ts').code).toContain('costarring');
			expect(transformSync('liquid;', 'collision.ts').code).toContain('liquid');
			await new Promise<void>(resolve => setImmediate(resolve));
			cache.clear();
			expect(transformSync('costarring;', 'collision.ts').code).toContain('costarring');
			expect(new Set(lookup.mock.calls.map(([key]) => key)).size).toBe(1);
		} finally { lookup.mockRestore() }
	});

	test('rejects cache entries without an exact request identity', () => {
		const lookup = vi.spyOn(cache, 'get');
		try {
			const source = 'export const fresh: number = 5;';
			stripTypes(source);
			cache.set(lookup.mock.calls.at(-1)![0], { code: 'wrong;' });
			expect(stripTypes(source).code).toContain('fresh');
			transformSync(source, 'identity.ts');
			cache.set(lookup.mock.calls.at(-1)![0], { code: 'wrong;' });
			expect(transformSync(source, 'identity.ts').code).toContain('fresh');
		} finally { lookup.mockRestore() }
	});

	test('does not cache failed native or esbuild inputs', () => {
		const publish = vi.spyOn(cache, 'set');
		try {
			for (let attempt = 0; attempt < 2; attempt += 1) {
				expect(() => stripTypes('const = ;')).toThrow();
				expect(() => transformSync('const = ;', 'failed-input.ts')).toThrow();
			}
			expect(publish).not.toHaveBeenCalled();
		} finally { publish.mockRestore() }
	});

	test('transformSync hashes effective and original sourcefile options', () => {
		const source = 'export const value = 1;';
		for (const [ firstPath, secondPath ] of [ [ 'a.ts', 'b.ts' ], [ 'a', 'a.js' ] ] as const) {
			const first = transformSync(source, 'same.ts', { sourcemap: true, sourcefile: firstPath });
			const second = transformSync(source, 'same.ts', { sourcemap: true, sourcefile: secondPath });
			expect(first.map?.sources).toEqual([ firstPath ]);
			expect(second.map?.sources).toEqual([ secondPath ]);
		}
	});

	test('transformSync hashes compiler contents under the same config identity', () => {
		const source = 'export const element = <div />;';
		const options = { tsconfigHash: '/project/tsconfig.json', loader: 'tsx' as const };
		const first = transformSync(source, 'compiler.tsx', {
			...options, tsconfigRaw: { compilerOptions: { jsxFactory: 'first' } },
		});
		const second = transformSync(source, 'compiler.tsx', {
			...options, tsconfigRaw: { compilerOptions: { jsxFactory: 'second' } },
		});
		expect(first.code).toContain('first(');
		expect(second.code).toContain('second(');
	});

	test('transformSync observes mutations in deferred compiler contents and other options', () => {
		const tsconfigRaw = { compilerOptions: { jsxFactory: 'before' } };
		const define = { VALUE: '1' };
		const options = {
			tsconfigHash: '/project/deferred.json', loader: 'tsx' as const, define,
			getTsconfigRaw: () => tsconfigRaw,
		};
		const source = 'export const element = <div value={VALUE} />;';
		const first = transformSync(source, 'mutable.tsx', options);
		tsconfigRaw.compilerOptions.jsxFactory = 'after';
		define.VALUE = '2';
		const second = transformSync(source, 'mutable.tsx', options);
		expect(first.code).toContain('before(');
		expect(first.code).toContain('value:1');
		expect(second.code).toContain('after(');
		expect(second.code).toContain('value:2');
	});

	test('transformSync distinguishes mutable regular expression options after disk reload', async () => {
		const source = 'export const value = { _first: 1, _second: 2 };';
		const options = { mangleProps: /^_first$/ };
		const first = transformSync(source, 'regexp-options.ts', options);
		await new Promise<void>(resolve => setImmediate(resolve));
		cache.clear();
		expect(transformSync(source, 'regexp-options.ts', options).code).toBe(first.code);
		options.mangleProps = /^_second$/;
		const second = transformSync(source, 'regexp-options.ts', options);
		expect(first.code).toContain('_second');
		expect(first.code).not.toContain('_first');
		expect(second.code).toContain('_first');
		expect(second.code).not.toContain('_second');
	});

	test('transformSync includes RegExp flags and reserveProps in exact option identity', () => {
		const source = 'export const value = { _first: 1, _second: 2 };';
		const insensitive = transformSync(source, 'regexp-flags.ts', { mangleProps: /^_FIRST$/i });
		const sensitive = transformSync(source, 'regexp-flags.ts', { mangleProps: /^_FIRST$/ });
		expect(insensitive.code).not.toContain('_first');
		expect(sensitive.code).toContain('_first');
		const first = transformSync(source, 'regexp-reserved.ts', { mangleProps: /^_/, reserveProps: /^_first$/ });
		const second = transformSync(source, 'regexp-reserved.ts', { mangleProps: /^_/, reserveProps: /^_second$/ });
		expect(first.code).toContain('_first');
		expect(first.code).not.toContain('_second');
		expect(second.code).toContain('_second');
		expect(second.code).not.toContain('_first');
	});

	test('transformSync does not let JSON-erased invalid options reuse a valid warm result', () => {
		const source = 'export const value = 1;';
		const filePath = 'invalid-warm-options.ts';
		const options = { minify: false, sourcemap: undefined } as unknown as NonNullable<Parameters<typeof transformSync>[2]>;
		transformSync(source, filePath, options);
		const invalid = { ...options, sourcemap: () => false } as unknown as Parameters<typeof transformSync>[2];
		expect(() => transformSync(source, filePath, invalid)).toThrow();
		const invalidConfig = { ...options, tsconfigRaw: () => ({}) } as unknown as Parameters<typeof transformSync>[2];
		expect(() => transformSync(source, filePath, invalidConfig)).toThrow();
		const invalidLoader = { ...options, loader: () => 'ts' } as unknown as Parameters<typeof transformSync>[2];
		expect(() => transformSync(source, filePath, invalidLoader)).toThrow();
		const unknown = { ...options, unknownOption: undefined };
		expect(() => transformSync(source, filePath, unknown)).toThrow('Invalid option');
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
		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).toHaveProperty('message', expect.stringContaining('invalid.ts'));
		expect(thrown).not.toHaveProperty('warnings');
	});
});