import { expect, describe, test } from 'vitest';
import { createFixture } from '../utils/fixture';
import { createTsconfigJson, getTsconfig } from '../utils/fixture-helpers';
import { getTscResolution, typescriptVersions } from '../utils/typescript-helpers';
import { createPathsMatcher } from '../../../src/utils/tsconfig-parser';

/**
 * Resolution is tested against the TypeScript compiler using:
 * npx tsc --traceResolution --noEmit
 */

describe.each(typescriptVersions)('paths (TypeScript %i)', (version) => {
	describe('error cases', () => {
		const nonRelativeErrorMessage = version === 7 ? 'Non-relative paths are not allowed. Did you forget a leading \'./\'?' : 'Non-relative paths are not allowed when \'baseUrl\' is not set. Did you forget a leading \'./\'?';

		test('no baseUrl or paths should be fine', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();
			expect(createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toBeNull();
		});

		test('no baseUrl nor relative paths', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						paths: {
							'@': ['src']
						}
					}
				})
			});

			let throwsError = false;
			try {
				await getTscResolution('@', fixture.path, version);
			} catch (error) {
				throwsError = true;
				expect(error).toHaveProperty('stdout', expect.stringContaining(nonRelativeErrorMessage));
			}
			expect(throwsError).toBe(true);

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();
			expect(() => createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toThrow(nonRelativeErrorMessage);
		});

		test('no baseUrl nor relative paths in extends', async () => {
			await using fixture = await createFixture({
				'some-dir2/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						paths: {
							'@': ['src']
						}
					}
				}),
				'some-dir/tsconfig.json': createTsconfigJson({
					extends: '../some-dir2/tsconfig.json'
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './some-dir/tsconfig.json'
				})
			});

			let throwsError = false;
			try {
				await getTscResolution('@', fixture.path, version);
			} catch (error) {
				throwsError = true;
				expect(error).toHaveProperty('stdout', expect.stringContaining(nonRelativeErrorMessage));
			}
			expect(throwsError).toBe(true);

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();
			expect(() => createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toThrow(nonRelativeErrorMessage);
		});

		test('multiple * in pattern', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						paths: {
							'a/*/*': ['src']
						}
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();
			expect(() => createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toThrow('Pattern \'a/*/*\' can have at most one \'*\' character.');
		});

		test('multiple * in substitution', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						paths: {
							'a/*': ['*/*']
						}
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();
			expect(() => createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toThrow('Substitution \'*/*\' in pattern \'a/*\' can have at most one \'*\' character.');
		});

		test('no match', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						paths: {
							'no-match': ['./b']
						}
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;

			expect(matcher).not.toBeNull();
			expect(matcher('specifier')).toStrictEqual([]);
		});

		/**
		 * TypeScript falls back to baseUrl when no paths pattern matches.
		 * tryLoadModuleUsingPathsIfEligible returns undefined for unmatched
		 * patterns, then tryLoadModuleUsingBaseUrl runs as a separate step.
		 *
		 * Reference: https://github.com/microsoft/TypeScript/blob/main/src/compiler/moduleNameResolver.ts#L1550-L1556
		 */
		test.skipIf(version === 7)('unmatched specifier falls back to baseUrl', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '.',
						paths: {
							'@/*': ['./src/*']
						}
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(matcher).not.toBeNull();

			const fixturePath = fixture.path.replaceAll('\\', '/');
			expect(matcher('@libs/constants')).toStrictEqual([
				`${fixturePath}@libs/constants`
			]);
		});

		// TS7 oracle exits 1 on baseUrl (TS5102); its trace has no baseUrl candidate
		test.runIf(version === 7)('unmatched specifier does not fall back to baseUrl', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '.',
						paths: {
							'@/*': ['./src/*']
						}
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(matcher).not.toBeNull();
			expect(matcher('@libs/constants')).toStrictEqual([]);
		});

		test.runIf(version === 7)('non-relative substitution throws even with baseUrl', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '.',
						paths: {
							'@': ['src']
						}
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();
			expect(() => createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toThrow(nonRelativeErrorMessage);
		});
	});

	describe('baseUrl', () => {
		// TS7 ignores baseUrl; TS7 counterparts below
		test.skipIf(version === 7)('absolute path', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '.'
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(matcher).not.toBeNull();

			const resolvedAttempts = await getTscResolution('exactMatch', fixture.path, version);
			expect(matcher('exactMatch')).toStrictEqual([
				resolvedAttempts[0]!.filePath.slice(0, -3)
			]);
		});

		// TS7 ignores baseUrl; TS7 counterparts below
		test.skipIf(version === 7)('inherited from extends', async () => {
			await using fixture = await createFixture({
				'src/lib/file': '',
				'some-dir/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						baseUrl: '..',
						paths: {
							$lib: [
								'src/lib'
							],
							'$lib/*': [
								'src/lib/*'
							]
						}
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './some-dir/tsconfig.json'
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(matcher).not.toBeNull();

			const resolvedAttempts = await getTscResolution('$lib', fixture.path, version);
			expect(matcher('$lib')).toStrictEqual([
				resolvedAttempts[0]!.filePath.slice(0, -3)
			]);
		});

		// TS7 ignores baseUrl; TS7 counterparts below
		test.skipIf(version === 7)('absolute path', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': ({ fixturePath }) => createTsconfigJson({
					compilerOptions: {
						baseUrl: fixturePath
					}
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(matcher).not.toBeNull();

			const resolvedAttempts = await getTscResolution('exactMatch', fixture.path, version);
			expect(matcher('exactMatch')).toStrictEqual([
				resolvedAttempts[0]!.filePath.slice(0, -3)
			]);
		});

		// TS7 oracle exits 1 on baseUrl (TS5102), so these expectations are hand-written from its trace
		describe.runIf(version === 7)('TS7 ignores baseUrl', () => {
			test('relative baseUrl without paths', async () => {
				await using fixture = await createFixture({
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							baseUrl: '.'
						}
					})
				});

				const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
				expect(tsconfig).not.toBeNull();
				expect(createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toBeNull();
			});

			test('absolute baseUrl without paths', async () => {
				await using fixture = await createFixture({
					'tsconfig.json': ({ fixturePath }) => createTsconfigJson({
						compilerOptions: {
							baseUrl: fixturePath
						}
					})
				});

				const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
				expect(tsconfig).not.toBeNull();
				expect(createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toBeNull();
			});

			test('inherited baseUrl does not allow non-relative substitutions', async () => {
				await using fixture = await createFixture({
					'src/lib/file': '',
					'some-dir/tsconfig.json': createTsconfigJson({
						compilerOptions: {
							baseUrl: '..',
							paths: {
								$lib: [
									'src/lib'
								],
								'$lib/*': [
									'src/lib/*'
								]
							}
						}
					}),
					'tsconfig.json': createTsconfigJson({
						extends: './some-dir/tsconfig.json'
					})
				});

				const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
				expect(tsconfig).not.toBeNull();
				expect(() => createPathsMatcher(tsconfig!, { typeScriptVersion: version })).toThrow('Non-relative paths are not allowed. Did you forget a leading \'./\'?');
			});

			test('substitutions resolve from the config, not baseUrl', async () => {
				await using fixture = await createFixture({
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							baseUrl: './base',
							paths: {
								'@/*': ['./src/*']
							}
						}
					})
				});

				const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
				expect(tsconfig).not.toBeNull();

				const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
				expect(matcher('@/foo')).toStrictEqual([fixture.getPath('src/foo').replaceAll('\\', '/')]);
			});

			test('inherited substitutions resolve from the declaring config, not child baseUrl', async () => {
				await using fixture = await createFixture({
					'configs/base.json': createTsconfigJson({
						compilerOptions: {
							paths: {
								'@/*': ['./src/*']
							}
						}
					}),
					'tsconfig.json': createTsconfigJson({
						extends: './configs/base.json',
						compilerOptions: {
							baseUrl: './base'
						}
					})
				});

				const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
				expect(tsconfig).not.toBeNull();

				const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
				expect(matcher('@/foo')).toStrictEqual([fixture.getPath('configs/src/foo').replaceAll('\\', '/')]);
			});

			test('matches absolute target paths', async () => {
				await using fixture = await createFixture({
					'tsconfig.json': ({ fixturePath, getPath }) => createTsconfigJson({
						compilerOptions: {
							baseUrl: fixturePath,
							paths: {
								dir: [getPath('dir')]
							}
						}
					})
				});

				const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
				expect(tsconfig).not.toBeNull();

				const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
				expect(matcher('dir')).toStrictEqual([fixture.getPath('dir').replaceAll('\\', '/')]);
			});
		});
	});

	test('exact match', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						exactMatch: ['./b']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(matcher).not.toBeNull();

		const resolvedAttempts = await getTscResolution('exactMatch', fixture.path, version);
		expect(matcher('exactMatch')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	// #17
	test('exact match with parent path', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						exactMatch: ['../src']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(matcher).not.toBeNull();

		const resolvedAttempts = await getTscResolution('exactMatch', fixture.path, version);
		expect(matcher('exactMatch')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	// TS7 strips '*' from exact-match substitutions; TS7 counterpart below
	test.skipIf(version === 7)('exact match with literal wildcard', async () => {
		await using fixture = await createFixture({
			'b/file': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						exactMatch: ['./b/*']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(tsconfig).not.toBeNull();

		const resolvedAttempts = await getTscResolution('exactMatch', fixture.path, version);
		expect(matcher('exactMatch')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	// TS7 probes the stripped candidate './b/' as a directory, so its first attempt is b/package.json
	test.runIf(version === 7)('exact match with literal wildcard strips the wildcard', async () => {
		await using fixture = await createFixture({
			'b/file': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						exactMatch: ['./b/*']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		const resolvedAttempts = await getTscResolution('exactMatch', fixture.path, version);
		expect(resolvedAttempts[0]!.filePath.endsWith('/b/package.json')).toBe(true);
		expect(matcher('exactMatch')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -'package.json'.length)
		]);
	});

	test('prefix match', async () => {
		await using fixture = await createFixture({
			'prefixed/specifier': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'prefix-*': ['./prefixed/*']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(tsconfig).not.toBeNull();

		const resolvedAttempts = await getTscResolution('prefix-specifier', fixture.path, version);
		expect(matcher('prefix-specifier')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	test('suffix match', async () => {
		await using fixture = await createFixture({
			'suffixed/specifier': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'*-suffix': ['./suffixed/*']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(tsconfig).not.toBeNull();

		const resolvedAttempts = await getTscResolution('specifier-suffix', fixture.path, version);
		expect(matcher('specifier-suffix')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	test('doesnt match current directory', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'.': ['./a']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;

		expect(tsconfig).not.toBeNull();
		expect(matcher('.')).toStrictEqual([]);
	});

	test('doesnt match parent directory', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'..': ['./a']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;

		expect(tsconfig).not.toBeNull();
		expect(matcher('..')).toStrictEqual([]);
	});

	test('doesnt match relative paths', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'./relative': ['./a']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;

		expect(tsconfig).not.toBeNull();
		expect(matcher('./relative')).toStrictEqual([]);
	});

	test('matches absolute paths', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'/absolute': ['./a']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(tsconfig).not.toBeNull();

		const resolvedAttempts = await getTscResolution('/absolute', fixture.path, version);
		expect(matcher('/absolute')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	// TS7 ignores baseUrl; TS7 counterpart in 'TS7 ignores baseUrl'
	test.skipIf(version === 7)('matches absolute target paths', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': ({ fixturePath, getPath }) => createTsconfigJson({
				compilerOptions: {
					baseUrl: fixturePath,
					paths: {
						dir: [getPath('dir')]
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(tsconfig).not.toBeNull();

		const resolvedAttempts = await getTscResolution('dir', fixture.path, version);
		expect(matcher('dir')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	test('matches path that starts with .', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'.src': ['./src']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(tsconfig).not.toBeNull();

		const resolvedAttempts = await getTscResolution('.src', fixture.path, version);
		expect(matcher('.src')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	});

	test('matches specifier with module extension', async () => {
		await using fixture = await createFixture({
			'src/x.mts': '',
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					paths: {
						'@/*': ['./src/*']
					}
				}
			})
		});

		const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;

		const resolvedAttempts = await getTscResolution('@/x.mjs', fixture.path, version);
		const tsResolved = resolvedAttempts.find(({ filePath }) => filePath.endsWith('/src/x.mts'));
		expect(tsResolved).toBeDefined();
		expect(matcher('@/x.mjs')).toStrictEqual([
			tsResolved!.filePath.replace(/\.mts$/, '.mjs')
		]);
	});

	describe('extends w/ no baseUrl', () => {
		test('extended config should resolve relative to self', async () => {
			await using fixture = await createFixture({
				tsconfigs: {
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							paths: {
								'@': [
									'./file'
								]
							}
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfigs/tsconfig.json'
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(tsconfig).not.toBeNull();

			const resolvedAttempts = await getTscResolution('@', fixture.path, version);
			expect(matcher('@')).toStrictEqual([
				resolvedAttempts[0]!.filePath.slice(0, -3)
			]);
		});

		test('extended config should implicitly resolve paths from self', async () => {
			await using fixture = await createFixture({
				tsconfigs: {
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							paths: {
								'@': [
									'./file'
								]
							}
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfigs/tsconfig.json'
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(tsconfig).not.toBeNull();

			const resolvedAttempts = await getTscResolution('@', fixture.path, version);
			expect(matcher('@')).toStrictEqual([
				resolvedAttempts[0]!.filePath.slice(0, -3)
			]);
		});

		test('extended config should implicitly resolve paths from self - complex', async () => {
			await using fixture = await createFixture({
				'file.ts': '',
				'some-dir2/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						paths: {
							'@': ['./a']
						}
					}
				}),
				'some-dir/tsconfig.json': createTsconfigJson({
					extends: '../some-dir2/tsconfig.json'
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './some-dir/tsconfig.json'
				})
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(tsconfig).not.toBeNull();

			const resolvedAttempts = await getTscResolution('@', fixture.path, version);
			expect(matcher('@')).toStrictEqual([
				resolvedAttempts[0]!.filePath.slice(0, -3)
			]);
		});
	});

	describe('${configDir}', () => {
		test('resolves paths with ${configDir}', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						paths: {
							'#/*': ['${configDir}/src/*']
						}
					}
				}),
				'src/index.ts': ''
			});

			const tsconfig = getTsconfig(fixture.path, { typeScriptVersion: version });
			expect(tsconfig).not.toBeNull();

			const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
			expect(matcher).not.toBeNull();

			const resolvedAttempts = await getTscResolution('#/index', fixture.path, version);
			expect(matcher('#/index')).toStrictEqual([
				resolvedAttempts[0]!.filePath.slice(0, -3)
			]);
		});
	});
});
