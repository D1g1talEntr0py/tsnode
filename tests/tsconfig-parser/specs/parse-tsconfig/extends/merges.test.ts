import { expect, describe, test } from 'vitest';
import { createFixture } from '../../../utils/fixture';
import { createTsconfigJson } from '../../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../../utils/typescript-helpers';
import { parseTsconfig } from '../../../../../src/utils/tsconfig-parser';

describe.each(typescriptVersions)('merges (TypeScript %i)', (version) => {
	describe('error handling', () => {
		test('invalid path', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					extends: './non-existent.json'
				})
			});

			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow('File \'./non-existent.json\' not found.');
		});

		test('invalid json', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.empty.json': 'import "node:fs"',
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfig.empty.json'
				})
			});

			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow('Cannot resolve tsconfig at path:');
		});
	});

	test('empty config file', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.empty.json': '{}',
			'tsconfig.json': createTsconfigJson({
				extends: './tsconfig.empty.json'
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig['compileOnSave']).toBe(expectedTsconfig['compileOnSave']);
		expect(tsconfig.compilerOptions).toStrictEqual({});
	});

	test('empty json', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.empty.json': createTsconfigJson({}),
			'tsconfig.json': createTsconfigJson({
				extends: './tsconfig.empty.json'
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	test('jsonc', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.base.json': `{
				// comment
				"compilerOptions": {
					"jsx": "react", // dangling comma
				},
			}`,
			'tsconfig.json': createTsconfigJson({
				extends: './tsconfig.base.json'
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	test('references is ignored', async () => {
		await using fixture = await createFixture({
			'tsconfig.base.json': createTsconfigJson({
				compilerOptions: {
					strict: true,
					jsx: 'react'
				},
				references: [
					{
						path: 'src'
					}
				]
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './tsconfig.base.json'
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	describe('files', () => {
		test('inherits with relative path', async () => {
			await using fixture = await createFixture({
				'some-dir': {
					src: {
						'a.ts': '',
						'b.ts': ''
					},
					'tsconfig.base.json': createTsconfigJson({
						files: [
							'src/a.ts'
						]
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './some-dir/tsconfig.base.json'
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('preserved when child has include', async () => {
			await using fixture = await createFixture({
				src: {
					'a.ts': ''
				},
				types: {
					'globals.d.ts': ''
				},
				'tsconfig.base.json': createTsconfigJson({
					files: [
						'types/globals.d.ts'
					]
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfig.base.json',
					include: ['src']
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			// tsc expands include globs into the files array, so compare
			// include/files/compilerOptions independently
			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig.include).toStrictEqual(expectedTsconfig.include);
			expect(tsconfig.files).toStrictEqual(['./types/globals.d.ts']);
			expect(tsconfig.compilerOptions).toStrictEqual(expectedTsconfig.compilerOptions);
		});

		test('preserved when child has files and parent has include', async () => {
			await using fixture = await createFixture({
				src: {
					'a.ts': ''
				},
				'globals.d.ts': '',
				'tsconfig.base.json': createTsconfigJson({
					include: ['src']
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfig.base.json',
					files: ['globals.d.ts']
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig.include).toStrictEqual(expectedTsconfig.include);
			expect(tsconfig.files).toStrictEqual(['./globals.d.ts']);
		});

		test('both inherited from parent', async () => {
			await using fixture = await createFixture({
				src: {
					'a.ts': ''
				},
				types: {
					'globals.d.ts': ''
				},
				'tsconfig.base.json': createTsconfigJson({
					files: ['types/globals.d.ts'],
					include: ['src']
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfig.base.json'
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig.include).toStrictEqual(expectedTsconfig.include);
			// tsc expands include globs into files; get-tsconfig keeps them separate
			expect(tsconfig.files).toStrictEqual(['./types/globals.d.ts']);
		});

		test('gets overwritten', async () => {
			await using fixture = await createFixture({
				'some-dir': {
					src: {
						'a.ts': '',
						'b.ts': ''
					},
					'tsconfig.base.json': createTsconfigJson({
						files: [
							'src/a.ts'
						]
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './some-dir/tsconfig.base.json',
					files: [
						'src/b.ts'
					]
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('include', () => {
		test('inherits with relative path', async () => {
			await using fixture = await createFixture({
				'src-a': {
					'a.ts': '',
					'b.ts': '',
					'c.ts': '',
					'tsconfig.base.json': createTsconfigJson({
						include: ['*']
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './src-a/tsconfig.base.json'
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		// #73 - include paths from extended configs in subdirectories
		// should preserve ../  (e.g. configs/../src-a/*), not normalize
		// Fixed in 446c458 via prefixPattern
		test('inherits with relative path from subdirectory', async () => {
			await using fixture = await createFixture({
				configs: {
					'tsconfig.base.json': createTsconfigJson({
						include: ['../src-a/*']
					})
				},
				'src-a': {
					'a.ts': '',
					'b.ts': '',
					'c.ts': ''
				},
				'tsconfig.json': createTsconfigJson({
					extends: './configs/tsconfig.base.json'
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('gets overwritten', async () => {
			await using fixture = await createFixture({
				'src-a': {
					'a.ts': '',
					'b.ts': '',
					'c.ts': ''
				},
				'src-b': {
					'a.ts': '',
					'b.ts': '',
					'c.ts': ''
				},
				'tsconfig.base.json': createTsconfigJson({
					include: ['src-a']
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfig.base.json',
					include: ['src-b']
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('inherits from symlinked configs', async () => {
			await using fixture = await createFixture({
				'symlink-source': {
					'tsconfig.base.json': createTsconfigJson({
						include: ['../src/*']
					})
				},
				project: {
					src: {
						'a.ts': '',
						'b.ts': '',
						'c.ts': ''
					},
					'tsconfig.json': createTsconfigJson({
						extends: './symlink/tsconfig.base.json'
					}),
					symlink: ({ symlink }) => symlink('../symlink-source')
				}
			});

			const expectedTsconfig = await getTscTsconfig(fixture.getPath('project'), undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('project/tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('handles ../.  without normalizing', async () => {
			await using fixture = await createFixture({
				nested: {
					'tsconfig.dev.json': createTsconfigJson({
						include: ['../.']
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './nested/tsconfig.dev.json'
				}),
				'a.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('baseUrl', () => {
		test('path becomes prefixed with ./', async () => {
			await using fixture = await createFixture({
				'src-a': {
					'a.ts': ''
				},
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: 'src-a'
					}
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('gets inherited with relative path', async () => {
			await using fixture = await createFixture({
				project: {
					'src-a': {
						'a.ts': ''
					},
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							baseUrl: 'src-a'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				})
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('resolves parent baseUrl path', async () => {
			await using fixture = await createFixture({
				'project/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '..'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'a.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('resolves parent baseUrl & paths', async () => {
			await using fixture = await createFixture({
				'project/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '.',
						paths: {
							'@/*': ['src/*']
						}
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'a.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			// TS7 records the declaring config directory even when baseUrl is set
			for (const symbol of Object.getOwnPropertySymbols(tsconfig.compilerOptions)) {
				// @ts-expect-error Symbol is private
				delete tsconfig.compilerOptions[symbol];
			}

			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('resolves parent baseUrl path defined in symlinked config', async () => {
			await using fixture = await createFixture({
				'symlink-source/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '..'
					}
				}),
				project: {
					'tsconfig.json': createTsconfigJson({
						extends: './symlink/tsconfig.json'
					}),
					'a.ts': '',
					symlink: ({ symlink }) => symlink('../symlink-source')
				}
			});

			const expectedTsconfig = await getTscTsconfig(fixture.getPath('project'), undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('project/tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('rootDir', () => {
		test('gets inherited with relative path', async () => {
			await using fixture = await createFixture({
				project: {
					src: {
						'a.ts': ''
					},
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							rootDir: 'src'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('resolves parent rootDir path', async () => {
			await using fixture = await createFixture({
				'project/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						rootDir: '..'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'a.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('rootDirs', () => {
		test('gets inherited with relative paths', async () => {
			await using fixture = await createFixture({
				project: {
					src: { 'a.ts': '' },
					generated: { 'b.ts': '' },
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							rootDirs: ['src', 'generated']
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('resolves parent rootDirs with mixed paths', async () => {
			await using fixture = await createFixture({
				project: {
					src: { 'a.ts': '' },
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							rootDirs: ['.', './types']
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('typeRoots', () => {
		test('gets inherited with relative paths', async () => {
			await using fixture = await createFixture({
				project: {
					types: { 'index.d.ts': '' },
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							typeRoots: ['types']
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('resolves parent typeRoots with multiple entries', async () => {
			await using fixture = await createFixture({
				project: {
					types: { 'index.d.ts': '' },
					'custom-types': { 'globals.d.ts': '' },
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							typeRoots: ['types', 'custom-types']
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './project/tsconfig.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('declarationDir', () => {
		test('gets inherited with relative path', async () => {
			await using fixture = await createFixture({
				'a/dep.json': createTsconfigJson({
					compilerOptions: {
						declaration: true,
						declarationDir: 'types'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './a/dep.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	describe('outFile and tsBuildInfoFile', () => {
		test('get inherited relative to the extending config', async () => {
			await using fixture = await createFixture({
				'configs/base.json': createTsconfigJson({
					compilerOptions: {
						incremental: true,
						outFile: 'out.js',
						tsBuildInfoFile: 'cache.tsbuildinfo'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './configs/base.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('get inherited from a parent directory', async () => {
			await using fixture = await createFixture({
				'base.json': createTsconfigJson({
					compilerOptions: {
						incremental: true,
						outFile: './out.js',
						tsBuildInfoFile: 'cache.tsbuildinfo'
					}
				}),
				project: {
					'tsconfig.json': createTsconfigJson({
						extends: '../base.json'
					}),
					'file.ts': ''
				}
			});

			const expectedTsconfig = await getTscTsconfig(fixture.getPath('project'), undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('project/tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('resolve inherited ${configDir} against the extending config', async () => {
			await using fixture = await createFixture({
				'configs/base.json': createTsconfigJson({
					compilerOptions: {
						incremental: true,
						outFile: '${configDir}/out.js',
						tsBuildInfoFile: '${configDir}/cache.tsbuildinfo'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './configs/base.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});
	});

	// TS7 --showConfig omits compileOnSave
	test.skipIf(version === 7)('nested extends', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'some-dir/some-dir/b': createTsconfigJson({
				extends: '../../c.json',
				compilerOptions: {
					module: 'esnext'
				}
			}),
			'c.json': createTsconfigJson({
				compileOnSave: true
			}),
			'tsconfig.a.json': createTsconfigJson({
				extends: './some-dir/some-dir/b',
				compilerOptions: {
					allowJs: true
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './tsconfig.a.json'
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	test('extends array', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.a.json': createTsconfigJson({
				compilerOptions: {
					allowJs: true,
					strict: true,
					jsx: 'react'
				}
			}),
			'tsconfig.b.json': createTsconfigJson({
				compilerOptions: {
					jsx: 'react-jsx'
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: ['./tsconfig.a.json', './tsconfig.b.json'],
				compilerOptions: {
					allowJs: false
				}
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	// TS7 --showConfig omits watchOptions
	test.skipIf(version === 7)('watchOptions', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.base.json': createTsconfigJson({
				watchOptions: {
					synchronousWatchDirectory: true,
					excludeDirectories: ['a', 'b']
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './tsconfig.base.json',
				watchOptions: {
					fallbackPolling: 'fixedinterval',
					excludeDirectories: ['c']
				}
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	// TS7 --showConfig omits watchOptions
	test.skipIf(version === 7)('watchOptions.excludeFiles', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.json': createTsconfigJson({
				watchOptions: {
					excludeFiles: ['file.ts']
				}
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	// TS7 --showConfig omits watchOptions
	test.skipIf(version === 7)('watchOptions enum normalization', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.json': createTsconfigJson({
				watchOptions: {
					watchFile: 'useFsEvents',
					watchDirectory: 'useFsEvents',
					fallbackPolling: 'dynamicPriority'
				}
			})
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	describe('${configDir}', () => {
		test('works in paths, include, excludes', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						outDir: '${configDir}/dist',
						paths: {
							'@/*': ['${configDir}/*']
						}
					},
					include: ['${configDir}/file.ts']
				}),
				extended: {
					'tsconfig.json': createTsconfigJson({
						extends: '../tsconfig.json'
					}),
					'file.ts': ''
				}
			});

			const expectedTsconfig = await getTscTsconfig(fixture.getPath('extended'), undefined, version);
			delete expectedTsconfig.files;

			const parsedTsconfig = parseTsconfig(fixture.getPath('extended/tsconfig.json'), { typeScriptVersion: version });
			const [implicitBaseUrl] = Object.getOwnPropertySymbols(parsedTsconfig.compilerOptions);

			// @ts-expect-error Symbol is private
			delete parsedTsconfig.compilerOptions[implicitBaseUrl];

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('joins path', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						outDir: '${configDir}-asdf/dist',
						declarationDir: '${configDir}/dist/declaration',
						outFile: '${configDir}/dist/outfile.js',
						rootDir: '${configDir}/dist/src',
						baseUrl: '${configDir}/dist/src',
						tsBuildInfoFile: '${configDir}/dist/dist.tsbuildinfo',
						rootDirs: ['${configDir}/src', '${configDir}/static'],
						typeRoots: ['${configDir}/src/type', '${configDir}/types'],
						paths: {
							a: ['${configDir}_a/*'],
							b: ['ignores/${configDir}/*']
						}
					},
					include: ['${configDir}/file.ts']
				}),
				extended: {
					'tsconfig.json': createTsconfigJson({
						extends: '../tsconfig.json'
					}),
					'file.ts': ''
				}
			});

			const expectedTsconfig = await getTscTsconfig(fixture.getPath('extended'), undefined, version);
			delete expectedTsconfig.files;

			const parsedTsconfig = parseTsconfig(fixture.getPath('extended/tsconfig.json'), { typeScriptVersion: version });
			const [implicitBaseUrl] = Object.getOwnPropertySymbols(parsedTsconfig.compilerOptions);

			// @ts-expect-error Symbol is private
			delete parsedTsconfig.compilerOptions[implicitBaseUrl];

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});

		test('parent path', async () => {
			await using fixture = await createFixture({
				'file-b.ts': '',
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						outDir: '${configDir}/../dist'
					},
					include: ['${configDir}/../file-b.ts']
				}),
				extended: {
					'tsconfig.json': createTsconfigJson({
						extends: '../tsconfig.json'
					})
				}
			});

			const expectedTsconfig = await getTscTsconfig(fixture.getPath('extended'), undefined, version);
			delete expectedTsconfig.files;

			const parsedTsconfig = parseTsconfig(fixture.getPath('extended/tsconfig.json'), { typeScriptVersion: version });
			const [implicitBaseUrl] = Object.getOwnPropertySymbols(parsedTsconfig.compilerOptions);

			// @ts-expect-error Symbol is private
			delete parsedTsconfig.compilerOptions[implicitBaseUrl];

			expect(parsedTsconfig).toStrictEqual(expectedTsconfig);
		});
	});
});
