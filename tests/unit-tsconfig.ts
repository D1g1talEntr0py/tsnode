import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, test } from 'vitest';
import { getTsconfigCacheKey, loadTsconfig, resolveTsconfigPaths } from '../src/utils/tsconfig';

describe('tsconfig utilities', () => {
	test('loadTsconfig returns a stable cached value', () => {
		const first = loadTsconfig();
		const second = loadTsconfig();

		expect(second).toBe(first);
	});

	test('loadTsconfig returns undefined for missing files', () => {
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));

		try {
			expect(loadTsconfig(path.join(temporaryDirectory, 'missing-tsconfig.json'))).toBeUndefined();
		} finally {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	test('getTsconfigCacheKey is stable for the same path', () => {
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		const configPath = path.join(temporaryDirectory, 'tsconfig.json');

		try {
			fs.writeFileSync(configPath, JSON.stringify({ compilerOptions: { allowJs: true } }));
			const first = getTsconfigCacheKey(configPath);
			const second = getTsconfigCacheKey(configPath);

			expect(second).toBe(first);
			expect(first).toContain(configPath);
		} finally {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	test('resolveTsconfigPaths resolves exact aliases and wildcards', () => {
		const resolved = resolveTsconfigPaths(
			{
				compilerOptions: {
					allowJs: false,
					baseUrl: '/project',
					paths: {
						'@app/*': ['src/*', 'generated/*'],
						'@core': ['src/core/index.ts'],
					},
				},
			},
			'@app/utils/math',
		);

		expect(resolved).toEqual([
			path.resolve('/project', 'src/utils/math'),
			path.resolve('/project', 'generated/utils/math'),
		]);

		expect(resolveTsconfigPaths(
			{
				compilerOptions: {
					allowJs: false,
					baseUrl: '/project',
					paths: {
						'@core': ['src/core/index.ts'],
					},
				},
			},
			'@core',
		)).toEqual([
			path.resolve('/project', 'src/core/index.ts'),
		]);
	});

	test('resolveTsconfigPaths returns an empty list for unmatched aliases', () => {
		expect(resolveTsconfigPaths(
			{
				compilerOptions: {
					allowJs: false,
					baseUrl: '/project',
					paths: {
						'@app/*': ['src/*'],
					},
				},
			},
			'lodash',
		)).toEqual([]);
	});
});