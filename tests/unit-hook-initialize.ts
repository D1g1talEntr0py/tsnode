import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { createFixture } from 'fs-fixture';
import { describe, expect, test, vi } from 'vitest';
import { createData, ensureParsedTsconfig } from '../src/hook/initialize';
import * as tsconfigUtilities from '../src/utils/tsconfig';

describe('hook initialize', () => {
	test('new registrations see missing-created and edited configs while existing registrations keep their snapshot', async () => {
		await using fixture = await createFixture({ 'entry.ts': '' });
		const configPath = path.join(fixture.path, 'tsconfig.json');
		const missing = createData({ tsconfig: configPath });
		expect(ensureParsedTsconfig(missing)).toBeUndefined();
		writeFileSync(configPath, JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }));
		const first = createData({ tsconfig: configPath });
		const original = ensureParsedTsconfig(first);
		expect(original?.compilerOptions.jsx).toBe('react-jsx');
		expect(ensureParsedTsconfig(missing)).toBeUndefined();
		writeFileSync(configPath, JSON.stringify({ compilerOptions: { jsx: 'react' } }));
		expect(ensureParsedTsconfig(createData({ tsconfig: configPath }))?.compilerOptions.jsx).toBe('react');
		expect(ensureParsedTsconfig(first)).toBe(original);
	});

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

	test('guards against reentrant config loading during resolver initialization', () => {
		const data = createData();
		const configuration = { compilerOptions: { allowJs: false, paths: {} } };
		const load = vi.spyOn(tsconfigUtilities, 'loadTsconfig').mockImplementationOnce(() => {
			expect(data.hasLoadedTsconfig).toBe(true);
			expect(ensureParsedTsconfig(data)).toBeUndefined();
			return configuration;
		});
		try {
			expect(ensureParsedTsconfig(data)).toBe(configuration);
			expect(load).toHaveBeenCalledTimes(1);
		} finally { load.mockRestore() }
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

		expect(parsed).toMatchObject({
			compilerOptions: {
				allowJs: true,
				paths: { '@/*': ['./src/*'] },
			},
		});
		expect(parsed?.compilerOptions.baseUrl).toBeUndefined();
		expect(data.hasLoadedTsconfig).toBe(true);
		expect(ensureParsedTsconfig(data)).toBe(parsed);
	});
});