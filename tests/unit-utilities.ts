import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { tmpdir, legacyTempDirs, cacheSchemaVersion } from '../src/utils/temporary-directory';
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
	hasImportMetaMain,
	resolveEntrypointPath,
	tsExtensions,
	tsExtensionsPattern,
} from '../src/utils/path-utils';
import { getPipePath, isWindows } from '../src/utils/ipc/get-pipe-path';
import { findFirstPositionalIndex, removeArgvFlags, inheritedExecArgv } from '../src/remove-argv-flags';
import { getFormatFromFileUrl, getNamespace, namespaceQuery, canTryNativeTypeStripping, isNativeFileUrl } from '../src/hook/utils';
import { Json, type JsonString } from '../src/utils/json';

const flagDefinitions = {
	color: { type: Boolean },
	count: { type: Number, alias: 'c' },
	name: { type: String, alias: 'n' },
	withDash: { type: String },
} as const;

describe('unit utilities', () => {
	describe('JSON serialization', () => {
		test('references the native serializer and preserves the branded return type', () => {
			const data = { count: 2 };
			const serialized = Json.serialize(data);

			expectTypeOf(serialized).toEqualTypeOf<JsonString<typeof data>>();
			expectTypeOf(Json.serialize(data, ['count'])).toEqualTypeOf<JsonString<typeof data>>();
			expectTypeOf(Json.serialize(data, () => undefined)).toEqualTypeOf<JsonString<typeof data>>();
			expect(Json.serialize).toBe(JSON.stringify);
			expect(serialized).toBe('{"count":2}');
		});

		test('preserves native undefined results', () => {
			expect(Json.serialize(undefined)).toBeUndefined();
			expect(Json.serialize(() => true)).toBeUndefined();
			expect(Json.serialize(Symbol('value'))).toBeUndefined();
			expect(Json.serialize({ toJSON: () => undefined })).toBeUndefined();
			expect(Json.serialize({ count: 2 }, () => undefined)).toBeUndefined();
		});

		test('supports array and function replacers with indentation', () => {
			const data = { count: 2, hidden: true };

			expect(Json.serialize(data, ['count'], 2)).toBe('{\n  "count": 2\n}');
			expect(Json.serialize(data, (key, value) => key === 'hidden' ? undefined : value, '\t')).toBe('{\n\t"count": 2\n}');
			expect(Json.serialize(data, null)).toBe(Json.serialize(data));
		});
	});

	test('filters attached parent eval payloads and duplicate aliases without losing startup options', () => {
		expect(inheritedExecArgv(['-econsole.log(1)', '-p42', '--input-type=module', '-C', 'development', '--max_old_space_size', '128'], ['--conditions=development', 'entry.ts']))
			.toEqual(['--max_old_space_size', '128']);
	});

	describe('removeArgvFlags', () => {
		test('skips separated Node values while removing runner flags', () => {
			expect(removeArgvFlags({ noCache: { type: Boolean } }, ['--conditions', 'development', '--no-cache', 'input.ts', '--no-cache']))
				.toEqual(['--conditions', 'development', 'input.ts', '--no-cache']);
		});

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
		test('finds entries behind boolean and value Node flags', () => {
			expect(findFirstPositionalIndex({}, ['--no-warnings', '--conditions', 'development', 'file:///entry.ts'])).toBe(3);
			expect(findFirstPositionalIndex({}, ['-C', 'development', '--', 'entry.ts'])).toBe(3);
		});

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
		test('handles long comment gaps without reinterpreting closing delimiters', () => {
			const gap = '/* gap **/ '.repeat(1_000);
			expect(hasImportMetaMain(`import ${gap}.meta.url`)).toBe(false);
			expect(hasImportMetaMain(`import ${gap}.meta.main`)).toBe(true);
			expect(hasImportMetaMain('import /* first */ invalid /* second */ .meta.main')).toBe(false);
		});

		test('scans large entries and still detects a trailing main reference', () => {
			const source = 'import.meta.url;\n'.repeat(5_000);
			expect(hasImportMetaMain(source)).toBe(false);
			expect(hasImportMetaMain(`${source}console.log(import /* gap */ .meta.main)`)).toBe(true);
			expect(hasImportMetaMain(`${source}console.log(\`value: \${import.meta.main}\`)`)).toBe(true);
		});

		test.each([
			'console.log(`${import.meta.main}`)',
			'console.log(`${`${import.meta.main}`}`)',
			'const { main } = import.meta; console.log(main)',
			'console.log(import /* comment */ . meta /* comment */ . main)',
			'console.log(import.meta["main"])',
		])('detects main-sensitive code: %s', (source) => {
			expect(hasImportMetaMain(source)).toBe(true);
		});
		test.each(['`literal import.meta.main`', '"import.meta.main"', '// import.meta.main', 'console.log(import.meta.url)'])('ignores non-main code: %s', (source) => {
			expect(hasImportMetaMain(source)).toBe(false);
		});

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
			expect(legacyTempDirs).toContain(path.join(os.tmpdir(), `tsnode-${expectedUserId}`));
			expect(legacyTempDirs).not.toContain(tmpdir);
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