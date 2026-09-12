import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createProjectFixture } from './utils/fixture';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceResolveHookPath = path.join(import.meta.dirname, 'utils/source-resolve-hook.ts');
const registerPath = pathToFileURL(`${projectRoot}/src/api/register.ts`).href;

type ImportRequest = {
	specifier: string;
	parent?: string;
};

const runResolution = async (
	files: Record<string, string>,
	requests: ImportRequest[],
	options: { raw?: boolean; unscoped?: boolean; virtualSources?: Record<string, string> } = {},
) => {
	await using fixture = await createProjectFixture(files);
	const defaultParent = pathToFileURL(`${fixture.path}/entry.ts`).href;
	const useNamespace = options.unscoped !== true && options.virtualSources === undefined;
	const useScopedImport = useNamespace && options.raw !== true;
	const resolvedRequests = requests.map((request) => ({
		...request,
		parent: request.parent ? pathToFileURL(`${fixture.path}/${request.parent}`).href : undefined,
	}));
	const script = `
import { register } from ${JSON.stringify(registerPath)};
const imports = [];
	const handle = register(${useNamespace ? `{
	namespace: 'resolution-test',
	onImport: (url) => imports.push(url),
}` : `{
	onImport: (url) => imports.push(url),
	virtualSources: new Map(${JSON.stringify(Object.entries(options.virtualSources ?? {}))}),
}`});
const requests = ${JSON.stringify(resolvedRequests)};
const results = [];
try {
  for (const request of requests) {
    try {
			const module = await ${useScopedImport ? `handle.import(request.specifier, request.parent ?? ${JSON.stringify(defaultParent)})` : 'import(request.specifier)'};
			results.push({ keys: Object.keys(module).sort(), url: module.url, value: module.value });
    } catch (error) {
      results.push({ code: error?.code, message: error?.message });
    }
  }
  console.log(JSON.stringify({ imports, results }));
} finally {
  handle.unregister();
}
`;

	const { stdout, stderr } = await execFileAsync(process.execPath, [
		'--experimental-strip-types',
		'--import', sourceResolveHookPath,
		'--input-type=module',
		'--eval', script,
	], { cwd: fixture.path, env: { ...process.env, NODE_NO_WARNINGS: '1' } });

	expect(stderr).toBe('');
	return JSON.parse(stdout) as {
		imports: string[];
		results: Array<{ code?: string; keys?: string[]; message?: string; url?: string; value?: unknown }>;
	};
};

describe('resolve hook integration', () => {
	test('remaps JavaScript imports to TypeScript and resolves extensionless files', async () => {
		const result = await runResolution({
			'entry.ts': '',
			'from-js.ts': 'export const value = "js-remap";\n',
			'extensionless.ts': 'export const value = "ts";\n',
			'extensionless.tsx': 'export const value = "tsx";\n',
			'extensionless.jsx': 'export const value = "jsx";\n',
		}, [
			{ specifier: './from-js.js' },
			{ specifier: './extensionless' },
			{ specifier: './extensionless.tsx' },
			{ specifier: './extensionless.jsx' },
		]);

		expect(result.results.map(({ value }) => value)).toEqual(['js-remap', 'ts', 'tsx', 'jsx']);
	});

	test('resolves directories, index files, and dot-parent normalization', async () => {
		const result = await runResolution({
			'entry.ts': '',
			'index.ts': 'export const value = "root";\n',
			'dir/index.ts': 'export const value = "dir";\n',
			'nested/entry.ts': '',
			'nested/index.ts': 'export const value = "nested";\n',
		}, [
			{ specifier: './dir/' },
			{ specifier: './dir' },
			{ specifier: '.', parent: 'nested/entry.ts' },
			{ specifier: '..', parent: 'nested/entry.ts' },
		]);

		expect(result.results.slice(0, 2).map(({ value }) => value)).toEqual(['dir', 'dir']);
		expect(result.results.slice(2).map(({ value }) => value)).toEqual(['nested', 'root']);
	});

	test('uses tsconfig paths and baseUrl for bare aliases', async () => {
		const result = await runResolution({
			'tsconfig.json': JSON.stringify({ compilerOptions: {
				target: 'esnext',
				module: 'esnext',
				baseUrl: './src',
				paths: { '@app/*': ['app/*'] },
			} }),
			'entry.ts': '',
			'src/app/value.ts': 'export const value = "alias";\n',
		}, [{ specifier: '@app/value' }]);

		expect(result.results[0]).toMatchObject({ value: 'alias' });
	});

	test('only resolves TypeScript from JavaScript parents when allowJs is enabled', async () => {
		const files = {
			'tsconfig.json': JSON.stringify({ compilerOptions: {
				target: 'esnext',
				module: 'esnext',
				allowJs: true,
			} }),
			'entry.ts': '',
			'allow.js': '',
			'target.tsx': 'export const value = "allow-js";\n',
		};
		const enabled = await runResolution(files, [{ specifier: './target', parent: 'allow.js' }]);

		expect(enabled.results[0]).toMatchObject({ value: 'allow-js' });
	});

	test('remaps package exports and does not treat a bare trailing slash as a directory', async () => {
		const result = await runResolution({
			'entry.ts': '',
			'node_modules/remapped/package.json': JSON.stringify({ type: 'module', exports: './index.js' }),
			'node_modules/remapped/index.ts': 'export const value = "package";\n',
			'node_modules/trailing/package.json': JSON.stringify({ type: 'module', exports: './index.ts' }),
			'node_modules/trailing/index.ts': 'export const value = "trailing";\n',
		}, [
			{ specifier: 'remapped' },
			{ specifier: 'trailing/' },
		]);

		expect(result.results[0]).toMatchObject({ value: 'package' });
		expect(result.results[1].code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
	});

	test('remaps JavaScript targets in package exports and imports maps', async () => {
		const result = await runResolution({
			'entry.ts': '',
			'node_modules/exports-user/package.json': JSON.stringify({ type: 'module', exports: {
				'.': './dist/index.js',
				'./feature': './dist/feature.js',
			} }),
			'node_modules/exports-user/dist/index.ts': 'export const value = "exports-root";\n',
			'node_modules/exports-user/dist/feature.ts': 'export const value = "exports-feature";\n',
			'node_modules/imports-user/package.json': JSON.stringify({ type: 'module', imports: { '#feature': './src/feature.js' } }),
			'node_modules/imports-user/entry.ts': '',
			'node_modules/imports-user/src/feature.ts': 'export const value = "imports-feature";\n',
		}, [
			{ specifier: 'exports-user' },
			{ specifier: 'exports-user/feature' },
			{ specifier: '#feature', parent: 'node_modules/imports-user/entry.ts' },
		]);

		expect(result.results.map(({ value }) => value)).toEqual(['exports-root', 'exports-feature', 'imports-feature']);
	});

	test('preserves import queries while applying the namespace', async () => {
		const result = await runResolution({
			'entry.ts': '',
			'value.ts': 'export const value = "query"; export const url = import.meta.url;\n',
		}, [{ specifier: './value.ts?raw=1' }]);

		expect(result.results[0]).toMatchObject({ value: 'query', url: expect.stringContaining('?raw=1') });
	});

	test('passes malformed and unmatched tsnode namespace requests through', async () => {
		const result = await runResolution({ 'entry.ts': '' }, [
			{ specifier: 'tsnode://not-json' },
			{ specifier: 'tsnode://{"specifier":"./value.ts","parentURL":"file:///tmp/entry.ts","namespace":"other"}' },
		], { raw: true });

		expect(result.imports).toEqual([]);
		expect(result.results.map(({ code }) => code)).toEqual(['ERR_UNSUPPORTED_ESM_URL_SCHEME', 'ERR_MODULE_NOT_FOUND']);
	});

	test('reports a missing index when resolving an existing directory', async () => {
		const result = await runResolution({
			'entry.ts': '',
			'empty/.keep': '',
		}, [{ specifier: './empty' }]);

		expect(result.results[0].code).toBe('ERR_MODULE_NOT_FOUND');
		expect(result.results[0].message).toContain('/empty/index');
	});

	test('passes through builtins and preserves unresolved errors without an index suffix', async () => {
		const builtin = await runResolution({ 'entry.ts': '' }, [{ specifier: 'node:path' }], { unscoped: true });
		const unresolved = await runResolution({ 'entry.ts': '' }, [{ specifier: './missing' }]);

		expect(builtin.results[0].keys).toContain('join');
		expect(unresolved.results[0].code).toBe('ERR_MODULE_NOT_FOUND');
		expect(unresolved.results[0].message).not.toContain('/index');
	});

	test('short-circuits virtual sources through resolve and load', async () => {
		const result = await runResolution(
			{ 'entry.ts': '' },
			[{ specifier: 'virtual:answer' }],
			{ virtualSources: { 'virtual:answer': 'export const value = "virtual";\n' } },
		);

		expect(result.results[0]).toMatchObject({ value: 'virtual' });
	});
});