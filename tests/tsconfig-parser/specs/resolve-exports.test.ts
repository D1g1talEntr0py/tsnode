import { describe, expect, test } from 'vitest';
import { resolveExports } from '../../../src/utils/tsconfig-parser/utils/resolve-exports';

// Ported from https://github.com/privatenumber/resolve-pkg-maps/tree/v1.0.0/tests/exports (Node.js comparisons omitted)

describe('resolveExports', () => {
	describe('error cases', () => {
		describe('invalid exports', () => {
			test('mixing conditional with paths', () => {
				const exports = { '.': './index.js', condition: './index.js' };

				expect(() => resolveExports(exports, '', [])).toThrow('[ERR_INVALID_PACKAGE_CONFIG]: "exports" cannot contain some keys starting with "." and some not');
			});

			test('numeric value', () => {
				// @ts-expect-error number type
				expect(() => resolveExports({ '.': 1 }, '', [])).toThrow('[ERR_INVALID_PACKAGE_TARGET]: Invalid "exports" target "1"');
			});

			test('boolean value', () => {
				// @ts-expect-error boolean type
				expect(() => resolveExports({ '.': true }, '', [])).toThrow('[ERR_INVALID_PACKAGE_TARGET]: Invalid "exports" target "true"');
			});

			test('numeric keys', () => {
				expect(() => resolveExports({ 0: './index.js' }, '', [])).toThrow('[ERR_INVALID_PACKAGE_CONFIG]: Cannot contain numeric property keys');
			});

			test.each([
				[ 'path doesnt start with ./', 'entry' ],
				[ './ in middle of path', './lib/./entry.js' ],
				[ 'starts with ..', '../entry' ],
				[ '../ in middle of path', './lib/../entry.js' ],
				[ 'node_modules in path', './lib/node_modules/entry.js' ],
				[ 'case insensitive node_modules in path', './lib/NODE_MODULES/entry.js' ]
			])('%s', (_, target) => {
				expect(() => resolveExports({ './entry': target }, 'entry', [])).toThrow(`[ERR_INVALID_PACKAGE_TARGET]: Invalid "exports" target "${target}"`);
			});

			test('error has code property', () => {
				expect(() => resolveExports({ './entry': '../entry' }, 'entry', [])).toThrow(expect.objectContaining({ code: 'ERR_INVALID_PACKAGE_TARGET' }));
			});
		});

		describe('throws on null exports', () => {
			test('main entry', () => {
				// @ts-expect-error invalid exports
				expect(() => resolveExports(null, '', [])).toThrow('"exports" is required');
			});

			test('subpath', () => {
				// @ts-expect-error invalid exports
				expect(() => resolveExports(null, 'non-existent-export.js', [])).toThrow('"exports" is required');
			});
		});

		describe('missing export', () => {
			test('non-existent export', () => {
				expect(() => resolveExports('./entry.js', 'non-existent-export', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./non-existent-export\' is not defined by "exports"');
			});

			test('null path', () => {
				expect(() => resolveExports({ './entry.js': null }, 'entry.js', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./entry.js\' is not defined by "exports"');
			});
		});
	});

	describe('basic', () => {
		describe('main entry point', () => {
			test('export string', () => {
				expect(resolveExports('./entry.js', '', [])).toStrictEqual([ './entry.js' ]);
			});

			test('export map', () => {
				const exports = { '.': './entry.js' };

				expect(resolveExports(exports, '', [])).toStrictEqual([ './entry.js' ]);
				expect(() => resolveExports(exports, '.', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./.\' is not defined by "exports"');
			});
		});

		test('multiple entries', () => {
			const exports = { './a': './lib/a.js', './.invisible': './.invisible.js' };

			expect(resolveExports(exports, 'a', [])).toStrictEqual([ './lib/a.js' ]);
			expect(resolveExports(exports, '.invisible', [])).toStrictEqual([ './.invisible.js' ]);
		});
	});

	describe('star', () => {
		test('static match', () => {
			expect(resolveExports({ './*': './file.js' }, 'any-entry', [])).toStrictEqual([ './file.js' ]);
		});

		test('dynamic match - prefix', () => {
			expect(resolveExports({ './prefix/*': './lib/*.js' }, 'prefix/a', [])).toStrictEqual([ './lib/a.js' ]);
		});

		test('dynamic match - prefix & suffix', () => {
			const exports = { './prefix/*.suffix': './lib/*.mjs' };

			expect(resolveExports(exports, 'prefix/a.suffix', [])).toStrictEqual([ './lib/a.mjs' ]);
			expect(resolveExports(exports, 'prefix/b.suffix', [])).toStrictEqual([ './lib/b.mjs' ]);
			expect(resolveExports(exports, 'prefix/directory/a/b/c.suffix', [])).toStrictEqual([ './lib/directory/a/b/c.mjs' ]);
		});

		test('error: shouldnt resolve value-less star', () => {
			expect(() => resolveExports({ './prefix/*.suffix': './lib/*.mjs' }, './prefix/.suffix', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'././prefix/.suffix\' is not defined by "exports"');
		});

		test('multiple stars', () => {
			expect(resolveExports({ './*.ext': './*/src/*.mjs' }, 'match.ext', [])).toStrictEqual([ './match/src/match.mjs' ]);
		});

		test('star treated literally if only in path', () => {
			expect(resolveExports({ './file': './lib/*.js' }, 'file', [])).toStrictEqual([ './lib/*.js' ]);
		});

		test('export ignored if multiple stars in key', () => {
			expect(() => resolveExports({ './*/*': './file.js' }, './dir/file.js', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'././dir/file.js\' is not defined by "exports"');
		});

		test('export ignored if consecutive stars in key', () => {
			expect(() => resolveExports({ './**': './file.js' }, 'file.js', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./file.js\' is not defined by "exports"');
		});

		test('path order - null blocks entry', () => {
			const exports = { './*': './*', './internal/*': null };

			expect(resolveExports(exports, 'file.js', [])).toStrictEqual([ './file.js' ]);
			expect(() => resolveExports(exports, 'internal/file.js', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./internal/file.js\' is not defined by "exports"');
		});

		test('path order - null blocks entry - same star position (compares entire length)', () => {
			const exports = { './*': './*', './*.js': null };

			expect(resolveExports(exports, 'file.mjs', [])).toStrictEqual([ './file.mjs' ]);
			expect(() => resolveExports(exports, 'file.js', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./file.js\' is not defined by "exports"');
		});

		test('path order - same prefix & length', () => {
			const exports = { './*.cjs': './*.cjs', './*.mjs': null };

			expect(resolveExports(exports, 'file.cjs', [])).toStrictEqual([ './file.cjs' ]);
			expect(() => resolveExports(exports, 'file.mjs', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./file.mjs\' is not defined by "exports"');
		});
	});

	describe('conditions', () => {
		describe('single entry - only conditions', () => {
			const exports = { 'condition-a': './lib/a.js', 'condition-b': './lib/b.js' };

			test('no match', () => {
				expect(() => resolveExports(exports, '', [])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined');
			});

			test('match', () => {
				expect(resolveExports(exports, '', [ 'condition-b' ])).toStrictEqual([ './lib/b.js' ]);
			});

			test('no match on non-existent condition', () => {
				expect(() => resolveExports(exports, '', [ 'nonexistent-condition' ])).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined');
			});
		});

		test('single-entry - with path', () => {
			const exports = { '.': { 'condition-a': './lib/a.js', 'condition-b': './lib/b.js' } };

			expect(resolveExports(exports, '', [ 'condition-b' ])).toStrictEqual([ './lib/b.js' ]);
		});

		test('use default when no conditions', () => {
			const exports = { '.': { 'condition-a': './lib/a.js', default: './lib/index.js' } };

			expect(resolveExports(exports, '', [])).toStrictEqual([ './lib/index.js' ]);
			expect(resolveExports(exports, '', [ 'non-existent-condition' ])).toStrictEqual([ './lib/index.js' ]);
		});

		test('nested conditions', () => {
			const exports = {
				node: { import: './node.import.js', require: './node.require.js' },
				browser: { import: './browser.import.js', require: './browser.require.js' }
			};

			expect(resolveExports(exports, '', [ 'require', 'node' ])).toStrictEqual([ './node.require.js' ]);
			expect(resolveExports(exports, '', [ 'node', 'import' ])).toStrictEqual([ './node.import.js' ]);
			expect(resolveExports(exports, '', [ 'import', 'browser' ])).toStrictEqual([ './browser.import.js' ]);
			expect(resolveExports(exports, '', [ 'require', 'browser' ])).toStrictEqual([ './browser.require.js' ]);
			expect(resolveExports(exports, '', [ 'node', 'require', 'random-condition-doesnt-matter' ])).toStrictEqual([ './node.require.js' ]);
			expect(() => resolveExports(exports, '', [])).toThrow('No "exports" main defined');
			expect(() => resolveExports(exports, '', [ 'node' ])).toThrow('No "exports" main defined');
		});
	});

	describe('fallback array', () => {
		test('skips false condition', () => {
			const exports = [ { 'condition-a': './a.js' }, './b.js', 'std:core-module' ];

			expect(resolveExports(exports, '', [])).toStrictEqual([ './b.js', 'std:core-module' ]);
		});

		test('returns array of matched fallback paths', () => {
			const exports = [ './a.js', { 'condition-b': './b.js' }, './c.js', { 'condition-d': './d.js', default: [ './e.js', './f.js' ] } ] as const;

			expect(resolveExports(exports, '', [])).toStrictEqual([ './a.js', './c.js', './e.js', './f.js' ]);
		});

		test('stars replaced', () => {
			const exports = {
				'./*': [
					{ condition: './dir-a/*.js' },
					'./dir-b/*.js',
					{ default: './dir-c/*.js' },
					{ default: { default: [ './dir-d/*', './dir-e/*/*.js' ] } }
				]
			} as const;

			expect(resolveExports(exports, 'file', [])).toStrictEqual([ './dir-b/file.js', './dir-c/file.js', './dir-d/file', './dir-e/file/file.js' ]);
		});
	});

	// Regression cases from https://github.com/lukeed/resolve.exports issues
	describe('compare with resolve.exports', () => {
		const conditions = [ 'worker', 'node' ];

		test('request starting with .', () => {
			expect(resolveExports({ './.hidden': './file.js' }, '.hidden', conditions)).toStrictEqual([ './file.js' ]);
		});

		test('null target exclusion', () => {
			expect(() => resolveExports({ './*': './*', './file.js': null }, 'file.js', conditions)).toThrow('[ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./file.js\' is not defined by "exports"');
		});

		test('fallback array is left to the caller', () => {
			expect(resolveExports({ './file': [ 'http://a.com', './file.js' ] }, 'file', conditions)).toStrictEqual([ 'http://a.com', './file.js' ]);
		});

		test('star with suffix', () => {
			expect(resolveExports({ './*.js': './*.js' }, 'file.js', conditions)).toStrictEqual([ './file.js' ]);
		});

		test('multiple stars in target', () => {
			expect(resolveExports({ './*.js': './*/*.js' }, 'file.js', conditions)).toStrictEqual([ './file/file.js' ]);
		});

		test('should apply suffix to star / order of exports should not matter', () => {
			expect(resolveExports({ './': './', './*': './*.js' }, 'file', conditions)).toStrictEqual([ './file.js' ]);
		});
	});

	describe('null targets within the map', () => {
		test('null condition stops conditional fallback', () => {
			expect(() => resolveExports({ '.': { require: null, default: './a.json' } }, '', [ 'require' ])).toThrow('No "exports" main defined');
		});

		test('null array entry is skipped', () => {
			// @ts-expect-error null array entries are outside the declared type
			expect(resolveExports([ null, './a.json' ], '', [])).toStrictEqual([ './a.json' ]);
		});

		test('null reached via condition in array is skipped', () => {
			expect(resolveExports([ { require: null }, './a.json' ], '', [ 'require' ])).toStrictEqual([ './a.json' ]);
		});

		test('unmatched nested condition does not fall through to sibling default', () => {
			expect(() => resolveExports({ '.': { node: { import: './b.json' }, default: './a.json' } }, '', [ 'node' ])).toThrow('No "exports" main defined');
		});
	});
});
