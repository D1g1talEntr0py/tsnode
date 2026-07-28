import { describe, expect, test } from 'vitest';
import { createData, ensureParsedTsconfig } from '../src/hook/initialize';

describe('hook initialize', () => {
	test('createData maps initialization options', () => {
		const onImport = () => {};

		expect(createData({
			namespace: 'scope-a',
			onImport,
			tsconfig: false,
		})).toMatchObject({
			active: true,
			hasLoadedTsconfig: false,
			namespace: 'scope-a',
			onImport,
			tsconfig: false,
		});
	});

	test('ensureParsedTsconfig short-circuits when tsconfig is disabled', () => {
		const data = createData({ tsconfig: false });

		expect(ensureParsedTsconfig(data)).toBeUndefined();
		expect(data.hasLoadedTsconfig).toBe(true);
		expect(data.parsedTsconfig).toBeUndefined();
	});

	test('ensureParsedTsconfig returns existing parsed config when already loaded', () => {
		const data = createData();
		const parsed = {
			compilerOptions: {
				allowJs: false,
				baseUrl: '/',
				paths: {},
			},
		};

		data.hasLoadedTsconfig = true;
		data.parsedTsconfig = parsed;

		expect(ensureParsedTsconfig(data)).toBe(parsed);
	});
});