import { expect, describe, test } from 'vitest';
import { createFixture } from '../../utils/fixture';
import { createTsconfigJson } from '../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../utils/typescript-helpers';
import { parseTsconfig } from '../../../../src/utils/tsconfig-parser';
import { Json } from '../../../../src/utils/json';

describe.each(typescriptVersions)('parses tsconfig (TypeScript %i)', (version) => {
	describe('errors', () => {
		test('non-existent path', async () => {
			expect(
				() => parseTsconfig('non-existent-path', { typeScriptVersion: version })
			).toThrow('Cannot resolve tsconfig at path: ');
		});

		test('preserves original error as cause', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': '{ "compilerOptions": {},'
			});

			expect(
				() => parseTsconfig('non-existent-path', { typeScriptVersion: version })
			).toThrow(expect.objectContaining({
				message: expect.stringContaining('Cannot resolve tsconfig at path: '),
				cause: expect.objectContaining({ code: 'ENOENT' })
			}));

			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow(expect.objectContaining({
				message: expect.stringContaining('Cannot resolve tsconfig at path:'),
				cause: expect.any(SyntaxError)
			}));
		});

		test.each([
			['empty document', ''],
			['invalid token', 'asdf'],
			['missing closing brace', '{ "compilerOptions": {},'],
			['trailing content', '{ "compilerOptions": {} } invalid']
		])('invalid JSONC: %s', async (_name, source) => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': source
			});

			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow('Cannot resolve tsconfig at path:');
		});

		test('json non-object', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': '"asdf"'
			});

			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow('Cannot resolve tsconfig at path:');
		});

		test('json empty', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': '{}'
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	test('parses a path', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					moduleResolution: 'node10',
					isolatedModules: true,
					module: 'esnext',
					esModuleInterop: true,
					declaration: true,
					outDir: 'dist',
					declarationDir: 'dist-declaration',
					strict: true,
					target: 'esnext',
					rootDir: 'root-dir'
				}
			})
		});

		const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(parsedTsconfig.compilerOptions).toStrictEqual({
			moduleResolution: version === 7 ? 'node' : 'node10',
			isolatedModules: true,
			module: 'esnext',
			esModuleInterop: true,
			declaration: true,
			outDir: './dist',
			declarationDir: './dist-declaration',
			strict: true,
			target: 'esnext',
			rootDir: './root-dir'
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		expect(parsedTsconfig.exclude).toStrictEqual(expectedTsconfig.exclude);
	});

	test('implicit config', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					target: 'es2022',
					module: 'preserve'
				}
			})
		});

		const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		expect(expectedTsconfig).toStrictEqual(parsedTsconfig);
	});

	describe('baseUrl', () => {
		test('relative path', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '.'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('absolute path', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: process.platform === 'win32' ? 'C:\\' : '/'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('rewriteRelativeImportExtensions', () => {
		test('does not add implied compiler options', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						rewriteRelativeImportExtensions: true
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(parsedTsconfig.compilerOptions).toStrictEqual({
				rewriteRelativeImportExtensions: true
			});
		});

		test('respects explicit allowImportingTsExtensions', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						rewriteRelativeImportExtensions: true,
						allowImportingTsExtensions: false
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('does not set allowImportingTsExtensions when false', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						rewriteRelativeImportExtensions: false
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('outFile and tsBuildInfoFile', () => {
		test('normalizes relative paths', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						incremental: true,
						outFile: 'out.js',
						tsBuildInfoFile: 'build/./nested/../cache.tsbuildinfo'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('interpolates ${configDir}', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						incremental: true,
						outFile: '${configDir}/out.js',
						tsBuildInfoFile: '${configDir}/cache.tsbuildinfo'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('lib', () => {
		test('normalizes to lowercase', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						lib: ['ES2020', 'DOM']
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('exclude', () => {
		test('does not add outDir when exclude is explicit', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						outDir: 'dist'
					},
					exclude: ['node_modules']
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		// TS7 --showConfig omits exclude: []
		test.skipIf(version === 7)('does not add outDir when exclude is empty array', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						outDir: 'dist'
					},
					exclude: []
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('does not add outDir when exclude is inherited', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'base.json': createTsconfigJson({
					compilerOptions: {
						outDir: 'dist'
					},
					exclude: ['node_modules']
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './base.json'
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('auto-adds outDir when exclude is not specified', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						outDir: 'dist'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('adds the overriding outDir, not the inherited one', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'base.json': createTsconfigJson({
					compilerOptions: {
						outDir: 'dist'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './base.json',
					compilerOptions: {
						outDir: 'build'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('adds outDir and declarationDir across extends', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'base.json': createTsconfigJson({
					compilerOptions: {
						declaration: true,
						declarationDir: 'types'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './base.json',
					compilerOptions: {
						outDir: 'build'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('adds output directories from nested configs relative to the root', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'base/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						declarationDir: 'types',
						outDir: 'dist'
					}
				}),
				'intermediate/tsconfig.json': createTsconfigJson({
					extends: '../base/tsconfig.json',
					compilerOptions: {
						outDir: 'build'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './intermediate/tsconfig.json'
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('adds output directories from the last extended config', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'first/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						outDir: 'dist'
					}
				}),
				'second/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						declarationDir: 'types',
						outDir: 'build'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: [
						'./first/tsconfig.json',
						'./second/tsconfig.json'
					]
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('outDir and declarationDir', () => {
		test.each([
			['. and .. segments', { outDir: 'a/../dist', declarationDir: './b/./types' }],
			['trailing slash', { outDir: 'dist/', declarationDir: './types/' }],
			['${configDir}', { outDir: '${configDir}/dist', declarationDir: '${configDir}/a/../types/' }]
		])('normalizes %s', async (_name, outputOptions) => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						declaration: true,
						...outputOptions
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test.each([
			['inside', 'project'],
			['outside', 'outside']
		])('normalizes absolute path %s the project', async (_name, directory) => {
			await using fixture = await createFixture({
				'project/file.ts': '',
				'project/tsconfig.json': ({ getPath }) => createTsconfigJson({
					compilerOptions: {
						declaration: true,
						outDir: `${getPath(directory)}/a/../dist`,
						declarationDir: `${getPath(directory)}/types/`
					}
				})
			});

			const projectPath = fixture.getPath('project');
			const parsedTsconfig = parseTsconfig(fixture.getPath('project/tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(projectPath, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test.each([
			['configs/base.json', 'project/configs/base.json', './configs/base.json'],
			['../base.json', 'base.json', '../base.json']
		])('normalizes paths inherited from %s', async (_name, basePath, extendsPath) => {
			await using fixture = await createFixture({
				'project/file.ts': '',
				[basePath]: createTsconfigJson({
					compilerOptions: {
						declaration: true,
						outDir: 'a/../dist/',
						declarationDir: './b/./types'
					}
				}),
				'project/tsconfig.json': createTsconfigJson({
					extends: extendsPath
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('project/tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.getPath('project'), undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('interpolates inherited ${configDir}', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'configs/base.json': createTsconfigJson({
					compilerOptions: {
						declaration: true,
						outDir: '${configDir}/dist',
						declarationDir: '${configDir}/./types/'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './configs/base.json'
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('rootDirs and typeRoots', () => {
		test('normalizes . and .. segments', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						rootDirs: ['a/../src', './b/./c', 'd/'],
						typeRoots: ['x/../types', './y/./z/']
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('normalizes inherited . and .. segments', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'configs/base.json': createTsconfigJson({
					compilerOptions: {
						rootDirs: ['a/../src', './b/./c/'],
						typeRoots: ['x/../types', './y/./z']
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './configs/base.json'
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	test('cache', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					baseUrl: '.',
					moduleResolution: 'node10',
					isolatedModules: true,
					module: 'esnext',
					esModuleInterop: true,
					declaration: true,
					outDir: 'dist',
					strict: true,
					target: 'esnext'
				}
			})
		});

		const cache = new Map();
		const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { cache, typeScriptVersion: version });
		expect(cache.size).toBe(1);

		const parsedTsconfigCached = parseTsconfig(fixture.getPath('tsconfig.json'), { cache, typeScriptVersion: version });
		expect(cache.size).toBe(1);

		expect(parsedTsconfigCached).toStrictEqual(parsedTsconfig);
	});

	describe('enum case normalization', () => {
		test('normalizes jsx to lowercase', async () => {
			await using fixture = await createFixture({
				'file.tsx': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						// @ts-expect-error testing mixed case input
						jsx: 'React-JSX'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('normalizes moduleDetection to lowercase', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						moduleDetection: 'Force'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('normalizes importsNotUsedAsValues to lowercase', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						// @ts-expect-error testing mixed case input
						importsNotUsedAsValues: 'Preserve'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('normalizes newLine to lowercase', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						newLine: 'CRLF'
					}
				})
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test.each(['Node', 'NODE10'])('normalizes moduleResolution %s', async (moduleResolution) => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': Json.serialize({ compilerOptions: { moduleResolution } })!
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(parsedTsconfig.compilerOptions).toStrictEqual({ moduleResolution: version === 7 ? 'node' : 'node10' });
		});
	});

	describe('options removed in TypeScript 7', () => {
		const removedOptions = {
			out: 'out.js',
			charset: 'utf8',
			keyofStringsOnly: true,
			suppressImplicitAnyIndexErrors: true,
			noImplicitUseStrict: true,
			noStrictGenericChecks: true,
			preserveValueImports: true,
			importsNotUsedAsValues: 'Remove',
			plugins: [{ name: 'plugin' }],
			target: 'ES3',
			module: 'None',
			strict: true
		};

		test.runIf(version === 7)('are dropped', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': Json.serialize({ compilerOptions: removedOptions })!
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		// TS6 --showConfig also adds implied options, which parseTsconfig does not
		test.runIf(version === 6)('are kept and normalized', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': Json.serialize({ compilerOptions: removedOptions })!
			});

			const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(parsedTsconfig.compilerOptions).toStrictEqual({
				...removedOptions,
				importsNotUsedAsValues: 'remove',
				target: 'es3',
				module: 'none'
			});
		});
	});

	// TS7 --showConfig omits watchOptions, compileOnSave and exclude: [], so compare with TS6
	test('keeps deprecated options and settings TS7 --showConfig omits', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					baseUrl: '.',
					outFile: 'out.js',
					downlevelIteration: true,
					esModuleInterop: false,
					allowSyntheticDefaultImports: false,
					alwaysStrict: false
				},
				compileOnSave: true,
				watchOptions: {
					watchFile: 'UseFsEvents'
				},
				exclude: []
			})
		});

		const parsedTsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, 6);
		delete expectedTsconfig.files;

		expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
	});
});
