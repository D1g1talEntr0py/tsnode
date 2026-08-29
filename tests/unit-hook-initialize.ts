import path from 'node:path';
import { createFixture } from 'fs-fixture';
import { describe, expect, test } from 'vitest';
import { createData, ensureParsedTsconfig } from '../src/hook/initialize';

describe('hook initialize', () => {
	test('createData maps initialization options', () => {
		const onImport = () => {};
		const virtualSources = new Map([['virtual.ts', 'export default 1']]);

		expect(createData({
			namespace: 'scope-a',
			onImport,
			tsconfig: false,
			virtualSources,
		})).toEqual({
			active: true,
			hasLoadedTsconfig: false,
			namespace: 'scope-a',
			onImport,
			parsedTsconfig: undefined,
			tsconfig: false,
			virtualSources,
		});
	});

	test('createData supplies an inactive-free default state', () => {
		expect(createData()).toEqual({
			active: true,
			hasLoadedTsconfig: false,
			parsedTsconfig: undefined,
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

	test('ensureParsedTsconfig parses the configured file once and caches the result', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': JSON.stringify({ compilerOptions: { allowJs: true, paths: { '@/*': ['src/*'] } } }),
		});
		const data = createData({ tsconfig: path.join(fixture.path, 'tsconfig.json') });

		const parsed = ensureParsedTsconfig(data);

		expect(parsed).toEqual({
			compilerOptions: {
				allowJs: true,
				baseUrl: fixture.path,
				paths: { '@/*': ['src/*'] },
			},
		});
		expect(data.hasLoadedTsconfig).toBe(true);
		expect(ensureParsedTsconfig(data)).toBe(parsed);
	});
});