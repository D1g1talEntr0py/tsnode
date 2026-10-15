import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { transformSync } from 'esbuild';
import { getTsconfigCacheKey, loadTsconfig, resolveTsconfigPaths } from '../src/utils/tsconfig';
import { parseTsconfig } from '../src/utils/tsconfig-parser';
import { Json } from '../src/utils/json';

describe('tsconfig utilities', () => {
	test('parses shared ancestors once per invocation without retaining mutated results', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-config-dag-'));
		try {
			fs.mkdirSync(path.join(directory, 'nested'));
			fs.writeFileSync(path.join(directory, '0.json'), Json.serialize({ compilerOptions: { rootDir: './src', rootDirs: ['./types'], paths: { '@app/*': ['./src/*'] } } })!);
			for (let level = 1; level <= 10; level += 1) {
				fs.writeFileSync(path.join(directory, `${level}.json`), Json.serialize({ extends: [`./${level - 1}.json`, `./${level - 1}.json`] })!);
			}
			const configPath = path.join(directory, 'nested/tsconfig.json');
			fs.writeFileSync(configPath, Json.serialize({ extends: ['../10.json', '../9.json'] })!);
			let readCacheLookups = 0;
			class ReadCache extends Map<string, unknown> {
				override has(key: string) {
					if (key.startsWith('readFileSync:')) { readCacheLookups += 1 }
					return super.has(key);
				}
			}
			const first = parseTsconfig(configPath, { cache: new ReadCache() });
			expect(readCacheLookups).toBeLessThanOrEqual(12);
			expect(first.compilerOptions).toMatchObject({ rootDir: '../src', rootDirs: ['../types'] });
			first.compilerOptions!.rootDir = './changed';
			first.compilerOptions!.paths!['@app/*'] = ['./changed/*'];
			expect(parseTsconfig(configPath).compilerOptions).toMatchObject({ rootDir: '../src', paths: { '@app/*': ['./src/*'] } });
			const loaded = loadTsconfig(configPath)!;
			expect(resolveTsconfigPaths(loaded, '@app/value')).toEqual([path.join(directory, 'src/value')]);
			fs.writeFileSync(path.join(directory, '0.json'), Json.serialize({ compilerOptions: { rootDir: './other' } })!);
			expect(parseTsconfig(configPath).compilerOptions?.rootDir).toBe('../other');
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('uses exact config contents without initializing crypto', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			const source = '{ "compilerOptions": { "jsx": "react-jsx" } }';
			fs.writeFileSync(configPath, source);
			const result = spawnSync(process.execPath, [
				'--import', new URL('./utils/source-resolve-hook.ts', import.meta.url).href,
				'--input-type=module', '-e', `
					import { writeFileSync } from 'node:fs';
					const cryptoLoaded = () => process.moduleLoadList.includes('NativeModule crypto');
					const beforeImport = cryptoLoaded();
					const { loadTsconfig, getTsconfigCacheKey } = await import(${Json.serialize(new URL('../src/utils/tsconfig.ts', import.meta.url).href)});
					const afterImport = cryptoLoaded();
					const configPath = process.argv[1];
					loadTsconfig(configPath + '.missing');
					const afterMissing = cryptoLoaded();
					const parsed = loadTsconfig(configPath);
					const afterValid = cryptoLoaded();
					const identity = getTsconfigCacheKey(configPath, parsed);
					const sources = JSON.parse(identity);
					writeFileSync(configPath, '{ "compilerOptions": { "jsx": "preserve" } }');
					const changed = loadTsconfig(configPath);
					console.log(JSON.stringify({ beforeImport, afterImport, afterMissing, afterValid, sameIdentity: sources.some(([, source]) => source === process.argv[2]), changedIdentity: identity !== getTsconfigCacheKey(configPath, changed), jsx: changed?.compilerOptions.jsx }));
				`, configPath, source,
			], { encoding: 'utf-8' });
			expect(result.status, result.stderr).toBe(0);
			expect(Json.parse(result.stdout)).toEqual({ beforeImport: false, afterImport: false, afterMissing: false, afterValid: false, sameIdentity: true, changedIdentity: true, jsx: 'preserve' });
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('parses strict JSON and JSONC through the configuration library', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, '{ "compilerOptions": { "jsx": "react-jsx" } }');
			expect(loadTsconfig(configPath)?.compilerOptions.jsx).toBe('react-jsx');

			fs.writeFileSync(configPath, '{ /* config */ "compilerOptions": { "jsx": "preserve", }, }');
			expect(loadTsconfig(configPath)?.compilerOptions.jsx).toBe('preserve');
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test.each([
		['strict JSON', '{ "extends": "./base.json", "compilerOptions": { "jsxImportSource": "https://example.test/jsx/*literal*/" } }'],
		['BOM-prefixed JSON', '\uFEFF{ "extends": "./base.json", "compilerOptions": { "jsxImportSource": "https://example.test/jsx/*literal*/" } }'],
		['JSONC', '{ /* root */ "extends": "./base.json", "compilerOptions": { "jsxImportSource": "https://example.test/jsx/*literal*/", }, }'],
	])('preserves inherited options and literal strings for %s', (_name, source) => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(path.join(directory, 'base.json'), '{ "compilerOptions": { "jsx": "react-jsx", "paths": { "@app/*": ["src/*"] } } }');
			fs.writeFileSync(configPath, source);
			const parsed = loadTsconfig(configPath)!;
			expect(parsed.compilerOptions).toMatchObject({ jsx: 'react-jsx', jsxImportSource: 'https://example.test/jsx/*literal*/' });
			expect(resolveTsconfigPaths(parsed, '@app/value')).toEqual([path.join(directory, 'src/value')]);
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('parses JSONC comments, trailing commas, and inherited options and aliases', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			fs.mkdirSync(path.join(directory, 'shared'));
			fs.writeFileSync(path.join(directory, 'shared/base.json'), `{
				// Inherited options are JSONC too.
				"compilerOptions": {
					"jsx": "react-jsx", "jsxImportSource": "https://example.test/jsx",
					"experimentalDecorators": true, "useDefineForClassFields": false,
					"paths": { "@shared/*": ["src/*",], },
				},
			}`);
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, '\uFEFF{ /* root */ "extends": "./shared/base.json", }');
			const parsed = loadTsconfig(configPath)!;
			expect(parsed.compilerOptions).toMatchObject({ jsx: 'react-jsx', jsxImportSource: 'https://example.test/jsx', experimentalDecorators: true, useDefineForClassFields: false });
			expect(resolveTsconfigPaths(parsed, '@shared/value')).toEqual([path.join(directory, 'shared/src/value')]);
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test.each([
		['missing closing brace', '{ "compilerOptions": {},'],
		['missing comma', '{ "compilerOptions": {} "extends": "./base.json" }'],
		['unterminated comment', '{ "compilerOptions": {} /* unfinished }'],
		['unterminated string', '{ "compilerOptions": { "jsx": "react-jsx } }'],
		['unquoted property', '{ compilerOptions: {} }'],
		['trailing content', '{ "compilerOptions": {} } invalid'],
		['empty document', ''],
		['comment-only document', '// no config'],
		['invalid option shape', '{ /* config */ "compilerOptions": { "paths": { "@app/*": "src/*", }, }, }'],
	])('rejects JSONC with %s without throwing', (_name, source) => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, source);
			expect(loadTsconfig(configPath)).toBeUndefined();
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('rejects malformed inherited JSONC instead of retaining cached options', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			const basePath = path.join(directory, 'base.json');
			fs.writeFileSync(configPath, '{ "extends": "./base.json", }');
			fs.writeFileSync(basePath, '\uFEFF{ /* base */ "compilerOptions": { "jsx": "react-jsx", }, }');
			const original = loadTsconfig(configPath)!;
			expect(original.compilerOptions.jsx).toBe('react-jsx');
			fs.writeFileSync(basePath, '{ "compilerOptions": { "jsx": "preserve" }, broken }');
			expect(loadTsconfig(configPath)).toBeUndefined();
			fs.writeFileSync(basePath, '{ "compilerOptions": { "jsx": "preserve", }, }');
			const repaired = loadTsconfig(configPath)!;
			expect(repaired).not.toBe(original);
			expect(repaired.compilerOptions.jsx).toBe('preserve');
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('bounds retained configs and rejects cyclic inheritance', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, '{}');
			const original = loadTsconfig(configPath);
			for (let index = 0; index < 64; index += 1) {
				const otherPath = path.join(directory, `config-${index}.json`);
				fs.writeFileSync(otherPath, '{}');
				loadTsconfig(otherPath);
			}
			expect(loadTsconfig(configPath)).not.toBe(original);
			fs.writeFileSync(configPath, Json.serialize({ extends: './base.json' })!);
			fs.writeFileSync(path.join(directory, 'base.json'), Json.serialize({ extends: './tsconfig.json' })!);
			expect(loadTsconfig(configPath)).toBeUndefined();
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('merges multiple base configs and resolves package configs without executing package code', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			fs.mkdirSync(path.join(directory, 'node_modules/fixture-config'), { recursive: true });
			fs.writeFileSync(path.join(directory, 'node_modules/fixture-config/package.json'), Json.serialize({ main: 'index.js', tsconfig: 'base.json' })!);
			fs.writeFileSync(path.join(directory, 'node_modules/fixture-config/index.js'), 'throw new Error("do not execute config packages")');
			fs.writeFileSync(path.join(directory, 'node_modules/fixture-config/base.json'), Json.serialize({ compilerOptions: { baseUrl: './src', jsx: 'react-jsx', paths: { '@base/*': ['base/*'] } } })!);
			fs.writeFileSync(path.join(directory, 'override.json'), Json.serialize({ compilerOptions: { jsx: 'react' } })!);
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, Json.serialize({ extends: ['fixture-config', './override.json'] })!);
			const parsed = loadTsconfig(configPath)!;
			expect(parsed.compilerOptions.jsx).toBe('react');
			expect(resolveTsconfigPaths(parsed, '@base/value')).toEqual([path.join(directory, 'node_modules/fixture-config/src/base/value')]);
			fs.writeFileSync(configPath, Json.serialize({ extends: 'fixture-config', compilerOptions: { baseUrl: './own' } })!);
			expect(resolveTsconfigPaths(loadTsconfig(configPath)!, '@base/value')).toEqual([path.join(directory, 'own/base/value')]);
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('retains transform options and resolves inherited aliases relative to their declaring config', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			fs.mkdirSync(path.join(directory, 'shared'));
			fs.writeFileSync(path.join(directory, 'shared/base.json'), Json.serialize({ compilerOptions: {
				jsx: 'react-jsx', experimentalDecorators: true, useDefineForClassFields: false,
				paths: { '@shared/*': ['src/*'] },
			} })!);
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, Json.serialize({ extends: './shared/base' })!);
			const parsed = loadTsconfig(configPath)!;
			expect(parsed.compilerOptions).toMatchObject({ jsx: 'react-jsx', experimentalDecorators: true, useDefineForClassFields: false });
			expect(resolveTsconfigPaths(parsed, '@shared/value')).toEqual([path.join(directory, 'shared/src/value')]);
			fs.writeFileSync(configPath, Json.serialize({ extends: './shared/base', compilerOptions: { paths: { '@own/*': ['own/*'] } } })!);
			expect(resolveTsconfigPaths(loadTsconfig(configPath)!, '@own/value')).toEqual([path.join(directory, 'own/value')]);
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('invalidates missing, changed, and inherited configs and their content identities', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		const configPath = path.join(directory, 'tsconfig.json');
		const basePath = path.join(directory, 'base.json');
		try {
			expect(loadTsconfig(configPath)).toBeUndefined();
			const missingKey = getTsconfigCacheKey(configPath);
			fs.writeFileSync(configPath, Json.serialize({ extends: './base.json' })!);
			expect(loadTsconfig(configPath)).toBeUndefined();
			fs.writeFileSync(basePath, Json.serialize({ compilerOptions: { jsx: 'react-jsx' } })!);
			const first = loadTsconfig(configPath)!;
			const firstKey = getTsconfigCacheKey(configPath);
			expect(firstKey).not.toBe(missingKey);
			expect(loadTsconfig(configPath)).toBe(first);
			fs.writeFileSync(basePath, Json.serialize({ compilerOptions: { jsx: 'preserve' } })!);
			expect(loadTsconfig(configPath)?.compilerOptions.jsx).toBe('preserve');
			expect(getTsconfigCacheKey(configPath)).not.toBe(firstKey);
			expect(getTsconfigCacheKey(configPath, first)).toBe(firstKey);
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('does not resolve paths for configurations without a loaded matcher', () => {
		const configuration = { compilerOptions: { allowJs: false, baseUrl: '/project', paths: { '@app/*': ['app/*'] } } };
		expect(resolveTsconfigPaths(configuration, '@app/value')).toEqual([]);
	});

	test('resolves exact aliases before the longest wildcard prefix from a loaded config', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, Json.serialize({ compilerOptions: { paths: {
				'*': ['generic/*'], '@app/*': ['app/*'], '@app/deep/*': ['deep/*', 'fallback/*'], '@app/deep/exact': ['exact.ts'],
			} } })!);
			const configuration = loadTsconfig(configPath)!;
			expect(resolveTsconfigPaths(configuration, '@app/deep/exact')).toEqual([path.join(directory, 'exact.ts')]);
			expect(resolveTsconfigPaths(configuration, '@app/deep/value')).toEqual([path.join(directory, 'deep/value'), path.join(directory, 'fallback/value')]);
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

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
			fs.writeFileSync(configPath, Json.serialize({ compilerOptions: { allowJs: true } })!);
			const first = getTsconfigCacheKey(configPath);
			const second = getTsconfigCacheKey(configPath);

			expect(second).toBe(first);
			expect(first).toContain(configPath);
		} finally {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	test('loadTsconfig rejects valid JSON with invalid compiler option shapes', () => {
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		const configPath = path.join(temporaryDirectory, 'wrong-shape.json');

		try {
			fs.writeFileSync(configPath, Json.serialize({ compilerOptions: { paths: { '@app/*': 'src/*' } } })!);
			expect(loadTsconfig(configPath)).toBeUndefined();
		} finally {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	test('leaves esbuild option validation to esbuild', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			fs.writeFileSync(configPath, Json.serialize({ compilerOptions: { jsx: 'invalid', paths: { '@app/*': ['src/*'] } } })!);
			const configuration = loadTsconfig(configPath)!;
			expect(configuration).toBeDefined();
			expect(configuration.compilerOptions.jsx).toBe('invalid');
			expect(transformSync('const value = <div />;', { loader: 'tsx', tsconfigRaw: Json.serialize(configuration)! }).code).toContain('React.createElement');
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});

	test('invalidates identities for inherited comment-only edits and has no implicit baseUrl fallback', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-tsconfig-'));
		try {
			const configPath = path.join(directory, 'tsconfig.json');
			const basePath = path.join(directory, 'base.json');
			fs.writeFileSync(configPath, '{ "extends": "./base.json" }');
			fs.writeFileSync(basePath, '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }');
			const original = loadTsconfig(configPath)!;
			const identity = getTsconfigCacheKey(configPath, original);
			fs.writeFileSync(basePath, '{ /* changed */ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }');
			const changed = loadTsconfig(configPath)!;
			expect(changed).not.toBe(original);
			expect(getTsconfigCacheKey(configPath, changed)).not.toBe(identity);
			expect(resolveTsconfigPaths(changed, '@app/value')).toEqual([path.join(directory, 'src/value')]);
			expect(resolveTsconfigPaths(changed, 'unmatched')).toEqual([]);
		} finally { fs.rmSync(directory, { recursive: true, force: true }) }
	});
});