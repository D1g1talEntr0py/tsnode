import { describe, test, expect } from 'vitest';
import { createNodeCapabilities } from './utils/node-capabilities';

describe('Node capabilities', () => {
	test('reports the current Node 18 test support facts', () => {
		expect(createNodeCapabilities([18, 20, 5])).toEqual({
			cli: {
				testFlag: true,
				testRunnerGlob: false,
			},
			esm: {
				importAttributes: true,
				importMetaPathProperties: false,
				loadHookCanReadFile: false,
			},
			moduleApis: {
				register: true,
			},
			moduleResolution: {
				packageMainResolution: true,
			},
			typeScript: {
				nativeTypeScript: false,
			},
			webAssembly: {
				modules: false,
			},
		});
	});

	test('tracks ESM and module loader support facts', () => {
		expect(createNodeCapabilities([20, 18, 0])).toMatchObject({
			esm: {
				importAttributes: true,
				importMetaPathProperties: true,
				loadHookCanReadFile: true,
			},
		});

		expect(createNodeCapabilities([20, 19, 0])).toMatchObject({
			esm: {
				importAttributes: true,
				importMetaPathProperties: true,
				loadHookCanReadFile: true,
			},
		});

		expect(createNodeCapabilities([20, 9, 0]).esm.importAttributes).toBe(false);
		expect(createNodeCapabilities([20, 10, 0]).esm.importAttributes).toBe(true);
	});

	test('reports newer platform facts without selecting tsnode behavior', () => {
		expect(createNodeCapabilities([22, 18, 0])).toMatchObject({
			typeScript: {
				nativeTypeScript: true,
			},
			webAssembly: {
				modules: false,
			},
		});

		expect(createNodeCapabilities([22, 19, 0]).webAssembly.modules).toBe(true);
		expect(createNodeCapabilities([24, 11, 1]).moduleApis.register).toBe(true);
	});
});
