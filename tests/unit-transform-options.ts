import { describe, expect, test } from 'vitest';
import { baseConfig, patchOptions } from '../src/utils/transform/get-esbuild-options';

describe('transform options', () => {
	describe('baseConfig', () => {
		test('targets the running Node version with the default loader', () => {
			expect(baseConfig).toEqual({
				target: `node${process.versions.node}`,
				loader: 'default',
			});
		});
	});

	describe('patchOptions', () => {
		test('leaves source maps untouched when no sourcefile is provided', () => {
			const options = {} as Parameters<typeof patchOptions>[0];
			const patchResult = patchOptions(options);
			const result = patchResult({ code: 'export {}', map: JSON.stringify({ file: 'index.js' }) });

			expect(result.map.file).toBe('index.js');
		});

		test('appends a js extension for extensionless sourcefiles', () => {
			const options = { sourcefile: 'input' } as Parameters<typeof patchOptions>[0];
			const patchResult = patchOptions(options);
			const result = patchResult({
				code: 'export {}',
				map: JSON.stringify({ file: 'input.js', sources: ['input.js'] }),
			});

			expect(options.sourcefile).toBe('input.js');
			expect(result.map.file).toBe('input');
			expect(result.map.sources).toEqual(['input.js']);
		});

		test('keeps extensionful sourcefiles unchanged', () => {
			const options = { sourcefile: 'src/file.ts' } as Parameters<typeof patchOptions>[0];
			const patchResult = patchOptions(options);
			const result = patchResult({
				code: 'export {}',
				map: JSON.stringify({ file: 'src/file.ts', sources: ['src/file.ts'] }),
			});

			expect(options.sourcefile).toBe('src/file.ts');
			expect(result.map.file).toBe('src/file.ts');
			expect(result.map.sources).toEqual(['src/file.ts']);
		});

		test('keeps extensionful sourcefiles with query strings unchanged', () => {
			const options = { sourcefile: 'src/file.ts?cache=1' } as Parameters<typeof patchOptions>[0];
			const patchResult = patchOptions(options);
			const result = patchResult({
				code: 'export {}',
				map: JSON.stringify({ file: 'src/file.ts?cache=1', sources: ['src/file.ts?cache=1'] }),
			});

			expect(options.sourcefile).toBe('src/file.ts?cache=1');
			expect(result.map.file).toBe('src/file.ts?cache=1');
			expect(result.map.sources).toEqual(['src/file.ts?cache=1']);
		});
	});
});