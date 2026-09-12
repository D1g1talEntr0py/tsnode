import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { outdent } from './utils/outdent';
import { readJsonFile, readJsonFileSync } from '../src/utils/read-json-file';
import type { JsonValue } from '../src/utils/json';
import { tmpdir, legacyTmpdirs, cacheSchemaVersion } from '../src/utils/temporary-directory';
import {
	bgBlue,
	bgGray,
	gray,
	lightCyan,
	lightGreen,
	lightMagenta,
	setColorEnabled,
	yellow,
} from '../src/utils/ansi';
import {
	fileUrlPrefix,
	implicitTsExtensionsPattern,
	isBarePackageNamePattern,
	isDirectoryPattern,
	isFilePath,
	isJsonPattern,
	isRelativePath,
	nodeModulesPath,
	requestAcceptsQuery,
	entryUsesImportMetaMain,
	resolveEntrypointPath,
	tsExtensions,
	tsExtensionsPattern,
} from '../src/utils/path-utils';
import { getPipePath, isWindows } from '../src/utils/ipc/get-pipe-path';
import { findFirstPositionalIndex, removeArgvFlags } from '../src/remove-argv-flags';
import { getFormatFromFileUrl, getNamespace, namespaceQuery, canTryNativeTypeStripping, isNativeFileUrl } from '../src/hook/utils';

const flagDefinitions = {
	color: { type: Boolean },
	count: { type: Number, alias: 'c' },
	name: { type: String, alias: 'n' },
	withDash: { type: String },
} as const;

describe('unit utilities', () => {
	describe('removeArgvFlags', () => {
		test.each([
			{
				name: 'removes boolean long flags',
				argv: ['--color', 'input.ts'],
				expected: ['input.ts'],
			},
			{
				name: 'removes string flags with their values',
				argv: ['--name', 'value', 'input.ts'],
				expected: ['input.ts'],
			},
			{
				name: 'removes inline long flag values',
				argv: ['--count=3', 'input.ts'],
				expected: ['input.ts'],
			},
			{
				name: 'resolves camel-cased long flags',
				argv: ['--with-dash', 'input.ts'],
				expected: [],
			},
			{
				name: 'removes short aliases with values',
				argv: ['-n', 'value', 'input.ts'],
				expected: ['input.ts'],
			},
			{
				name: 'leaves unknown flags in place',
				argv: ['--unknown', 'input.ts'],
				expected: ['--unknown', 'input.ts'],
			},
			{
				name: 'stops after the first positional argument',
				argv: ['--name', 'value', 'input.ts', '--color'],
				expected: ['input.ts', '--color'],
			},
			{
				name: 'preserves the argv terminator',
				argv: ['--color', '--', '--name', 'value'],
				expected: ['--', '--name', 'value'],
			},
			{
				name: 'leaves an unknown flag and its following value in place',
				argv: ['--unknown', 'value', 'input.ts'],
				expected: ['--unknown', 'value', 'input.ts'],
			},
			{
				name: 'does not remove flags after the argv terminator',
				argv: ['--', '--color', '--name', 'value'],
				expected: ['--', '--color', '--name', 'value'],
			},
		])('$name', ({ argv, expected }) => {
			expect(removeArgvFlags(flagDefinitions, [...argv])).toEqual(expected);
		});
	});

	describe('findFirstPositionalIndex', () => {
		test.each([
			{
				name: 'returns -1 for flag-only argv',
				argv: ['--color', '--name', 'value'],
				expected: -1,
			},
			{
				name: 'finds the first positional after a consumed value',
				argv: ['--name', 'value', 'input.ts'],
				expected: 2,
			},
			{
				name: 'finds the first positional after an inline value',
				argv: ['--count=3', 'input.ts'],
				expected: 1,
			},
			{
				name: 'treats the argv terminator as the next positional index',
				argv: ['--name', 'value', '--', 'input.ts'],
				expected: 3,
			},
			{
				name: 'treats lone dash as positional',
				argv: ['-'],
				expected: 0,
			},
			{
				name: 'skips unknown flags before positional arguments',
				argv: ['--unknown', 'input.ts'],
				expected: 1,
			},
		])('$name', ({ argv, expected }) => {
			expect(findFirstPositionalIndex(flagDefinitions, argv)).toBe(expected);
		});
	});

	describe('path utilities', () => {
		test('detects import.meta.main without matching comments or strings', () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-import-meta-'));
			const entryPath = path.join(directory, 'entry.ts');

			try {
				fs.writeFileSync(entryPath, [
					'// import.meta.main',
					'const text = "import.meta.main";',
					'const bracketText = `import.meta[\'main\']`;',
					'console.log(import.meta.main);',
				].join('\n'));

				expect(entryUsesImportMetaMain(entryPath)).toBe(true);
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test('does not detect import.meta.main in comments or strings', () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-import-meta-'));
			const entryPath = path.join(directory, 'entry.ts');

			try {
				fs.writeFileSync(entryPath, [
					'/* import.meta.main */',
					'const text = "import.meta.main";',
					'const bracketText = `import.meta[\'main\']`;',
				].join('\n'));

				expect(entryUsesImportMetaMain(entryPath)).toBe(false);
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test('resolves real extension and index fallbacks', () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-entrypoint-'));
			const extensionlessRequest = path.join(directory, 'extensionless');
			const directoryRequest = path.join(directory, 'directory');
			const extensionlessFile = `${extensionlessRequest}.tsx`;
			const indexFile = path.join(directoryRequest, 'index.jsx');

			try {
				fs.mkdirSync(directoryRequest);
				fs.writeFileSync(extensionlessFile, 'export const value = 1;');
				fs.writeFileSync(indexFile, 'export const value = 2;');

				expect(resolveEntrypointPath(extensionlessRequest)).toBe(extensionlessFile);
				expect(resolveEntrypointPath(directoryRequest)).toBe(indexFile);
				expect(resolveEntrypointPath(path.join(directory, 'missing'))).toBeUndefined();
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test.each([
			['./file.ts', true],
			['../file.ts', true],
			['file.ts', false],
			['.file.ts', false],
		])('isRelativePath(%s)', (request, expected) => {
			expect(isRelativePath(request)).toBe(expected);
		});

		test.each([
			['./file.ts', true],
			['/tmp/file.ts', true],
			['file.ts', false],
			['node:url', false],
		])('isFilePath(%s)', (request, expected) => {
			expect(isFilePath(request)).toBe(expected);
		});

		test.each([
			['./file.ts?query', true],
			['/tmp/file.ts?query', true],
			['file.ts?query', undefined],
			['node:url?query', false],
			['https://example.com/file.ts?query', true],
		])('requestAcceptsQuery(%s)', (request, expected) => {
			expect(requestAcceptsQuery(request)).toBe(expected);
		});

		test('exposes the expected path constants and regexes', () => {
			expect(fileUrlPrefix).toBe('file://');
			expect(tsExtensions).toEqual(['.ts', '.tsx', '.jsx']);
			expect('.ts').toMatch(tsExtensionsPattern);
			expect('.tsx').toMatch(implicitTsExtensionsPattern);
			expect('file.json?1').toMatch(isJsonPattern);
			expect('file/?query').toMatch(isDirectoryPattern);
			expect('@scope/pkg').toMatch(isBarePackageNamePattern);
			expect('@scope/pkg/file').not.toMatch(isBarePackageNamePattern);
			expect(nodeModulesPath).toBe(`${path.sep}node_modules${path.sep}`);
		});
	});

	describe('ansi helpers', () => {
		test.each([
			['gray', gray, '\u001B[90mtext\u001B[39m'],
			['lightCyan', lightCyan, '\u001B[96mtext\u001B[39m'],
			['lightMagenta', lightMagenta, '\u001B[95mtext\u001B[39m'],
			['lightGreen', lightGreen, '\u001B[92mtext\u001B[39m'],
			['yellow', yellow, '\u001B[33mtext\u001B[39m'],
			['bgBlue', bgBlue, '\u001B[44mtext\u001B[49m'],
			['bgGray', bgGray, '\u001B[100mtext\u001B[49m'],
		])('%s when colors are enabled', (_name, color, expected) => {
			setColorEnabled(true);
			expect(color('text')).toBe(expected);
			setColorEnabled(false);
		});

		test.each([
			gray,
			lightCyan,
			lightMagenta,
			lightGreen,
			yellow,
			bgBlue,
			bgGray,
		])('returns plain text when colors are disabled', (color) => {
			setColorEnabled(false);
			expect(color('text')).toBe('text');
		});
	});

	describe('ipc and temp paths', () => {
		test('formats the temporary directory for the current user', () => {
			const expectedUserId = process.geteuid ? process.geteuid() : os.userInfo().username;
			expect(tmpdir).toBe(path.join(os.tmpdir(), `tsnode-v${cacheSchemaVersion}-${expectedUserId}`));
		});

		test('supersedes previous cache directory layouts', () => {
			const expectedUserId = process.geteuid ? process.geteuid() : os.userInfo().username;

			// Bumping the schema version must leave the old directories sweepable
			expect(legacyTmpdirs).toContain(path.join(os.tmpdir(), `tsnode-${expectedUserId}`));
			expect(legacyTmpdirs).not.toContain(tmpdir);
		});

		test('formats pipe paths for the current platform', () => {
			const pipePath = getPipePath(1234);

			if (isWindows) {
				expect(pipePath).toMatch(/^\\\\\?\\pipe\\/);
				expect(pipePath).toContain('1234.pipe');
			} else {
				expect(pipePath).toBe(path.join(tmpdir, '1234.pipe'));
			}
		});
	});

	describe('json reading', () => {
		test('includes undefined in undecoded reader return types', () => {
			expectTypeOf(readJsonFileSync('config.json')).toEqualTypeOf<JsonValue | undefined>();
			expectTypeOf(readJsonFile('config.json')).toEqualTypeOf<Promise<JsonValue | undefined>>();
		});

		test('reads and parses valid JSON', () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-json-'));
			const filePath = path.join(directory, 'config.json');
			fs.writeFileSync(filePath, outdent`
				{
					"name": "tsnode",
					"enabled": true,
					"count": 2
				}
			`);

			try {
				expect(readJsonFileSync(filePath)).toEqual({
					name: 'tsnode',
					enabled: true,
					count: 2,
				});
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test('returns decoder-derived values', async () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-json-'));
			const filePath = path.join(directory, 'decoded.json');
			const decodeName = (value: unknown) => value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' ? value.name : undefined;
			fs.writeFileSync(filePath, JSON.stringify({ name: 'tsnode' }));

			try {
				expect(readJsonFileSync(filePath, decodeName)).toBe('tsnode');
				expect(await readJsonFile(filePath, decodeName)).toBe('tsnode');
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test('returns undefined for missing files', () => {
			const filePath = path.join(os.tmpdir(), `missing-tsnode-file-${Date.now()}-${Math.random()}.json`);
			expect(readJsonFileSync(filePath)).toBeUndefined();
		});

		test('returns undefined for missing files asynchronously', async () => {
			const filePath = path.join(os.tmpdir(), `missing-tsnode-file-${Date.now()}-${Math.random()}.json`);
			expect(await readJsonFile(filePath)).toBeUndefined();
		});

		test('returns undefined for missing file URLs', async () => {
			const fileUrl = pathToFileURL(path.join(os.tmpdir(), `missing-tsnode-file-${Date.now()}-${Math.random()}.json`));
			expect(readJsonFileSync(fileUrl)).toBeUndefined();
			expect(await readJsonFile(fileUrl)).toBeUndefined();
		});

		test('returns undefined for invalid JSON', () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-json-'));
			const filePath = path.join(directory, 'broken.json');
			fs.writeFileSync(filePath, '{"name": "tsnode", }');

			try {
				expect(readJsonFileSync(filePath)).toBeUndefined();
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test('returns undefined for invalid JSON asynchronously', async () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsnode-json-'));
			const filePath = path.join(directory, 'broken.json');
			fs.writeFileSync(filePath, '{"name": "tsnode", }');

			try {
				expect(await readJsonFile(filePath)).toBeUndefined();
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});
	});

	describe('hook url helpers', () => {
		test.each([
			['file:///project/file.ts', 'module'],
			['file:///project/file.ts?query', 'module'],
			['file:///project/file.jsx#hash', 'module'],
			['file:///project/file.js', undefined],
			['file:///project/file.txt', undefined],
		])('getFormatFromFileUrl(%s)', (fileUrl, expected) => {
			expect(getFormatFromFileUrl(fileUrl)).toBe(expected);
		});

		test.each([
			['file:///project/file.ts', true],
			['file:///project/file.ts?cache=1', true],
			['file:///project/file.tsx', false],
			['file:///project/node_modules/pkg/index.ts', false],
		])('isNativeFileUrl(%s)', (url, expected) => {
			expect(isNativeFileUrl(url)).toBe(expected);
		});

		test.each([
			['file:///project/file.ts', true],
			['file:///project/file.ts?cache=1', true],
			['file:///project/file.tsx', false],
			['file:///project/node_modules/pkg/index.ts', false],
		])('canTryNativeTypeStripping(%s)', (url, expected) => {
			expect(canTryNativeTypeStripping(url)).toBe(expected);
		});

		test.each([
			[
				`file:///project/file.ts?${namespaceQuery}alpha&mode=esm`,
				'alpha',
			],
			[
				`file:///project/file.ts?mode=esm&${namespaceQuery}beta`,
				'beta',
			],
			[
				`file:///project/file.ts?mode=esm`,
				undefined,
			],
			[
				`file:///project/file.ts?x${namespaceQuery}gamma`,
				undefined,
			],
		])('getNamespace(%s)', (url, expected) => {
			expect(getNamespace(url)).toBe(expected);
		});
	});
});