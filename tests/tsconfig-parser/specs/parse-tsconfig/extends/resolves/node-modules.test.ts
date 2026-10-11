import path from 'node:path';
import { expect, describe, test } from 'vitest';
import { createFixture } from '../../../../utils/fixture';
import { createTsconfigJson, createPackageJson } from '../../../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../../../utils/typescript-helpers';
import { parseTsconfig } from '../../../../../../src/utils/tsconfig-parser';

describe.each(typescriptVersions)('node_modules (TypeScript %i)', (version) => {
	test('prefers file over package', async () => {
		await using fixture = await createFixture({
			node_modules: {
				'dep.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react-native'
					}
				}),
				'dep/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react'
					}
				})
			},
			'tsconfig.json': createTsconfigJson({
				extends: 'dep'
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	describe('extends dependency', () => {
		test('implicit tsconfig.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						main: './index.js'
					}),
					'index.js': 'import "node:fs"',
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							strict: true,
							jsx: 'react'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig.compilerOptions).toStrictEqual({
				strict: true,
				jsx: 'react'
			});
		});

		test('without package.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						strict: true,
						jsx: 'react'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig.compilerOptions).toStrictEqual({
				strict: true,
				jsx: 'react'
			});
		});

		test('ignores invalid package.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': 'invalid json',
					'some-config.json': createTsconfigJson({
						compilerOptions: {
							strict: true,
							jsx: 'react'
						}
					}),
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('ignores invalid package.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': 'invalid json',
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('empty package.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': '',
					'custom.json': createTsconfigJson({
						compilerOptions: {
							module: 'node16'
						}
					}),
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							module: 'esnext'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/custom.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig.compilerOptions).toStrictEqual({ module: 'node16' });
		});

		test('empty object package.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': '{}',
					'custom.json': createTsconfigJson({
						compilerOptions: {
							module: 'node16'
						}
					}),
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							module: 'esnext'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/custom.json'
				}),
				'file.ts': ''
			});

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(tsconfig.compilerOptions).toStrictEqual({ module: 'node16' });
		});
	});

	describe('dependency file', () => {
		test('direct tsconfig.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep/some-file.json': createTsconfigJson({
					compilerOptions: {
						strict: true,
						jsx: 'react'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/some-file.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(expectedTsconfig).toStrictEqual(tsconfig);
		});

		test('implicit .json extension', async () => {
			await using fixture = await createFixture({
				'node_modules/dep/react-native.json': createTsconfigJson({
					compilerOptions: {
						strict: true,
						jsx: 'react-native'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/react-native'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(expectedTsconfig).toStrictEqual(tsconfig);
		});

		test('prefers implicit .json over directory', async () => {
			await using fixture = await createFixture({
				'node_modules/config-package/lib/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react-jsxdev'
					}
				}),
				'node_modules/config-package/lib.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react-jsx'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: 'config-package/lib'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test.skipIf(version === 7)('extensionless file should not work', async () => {
			await using fixture = await createFixture({
				'node_modules/dep/tsconfig': createTsconfigJson({
					compilerOptions: {
						strict: true,
						jsx: 'react-native'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/tsconfig'
				}),
				'file.ts': ''
			});

			const errorMessage = 'File \'dep/tsconfig\' not found';
			await expect(
				getTscTsconfig(fixture.path)
			).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
			expect(() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })).toThrow(errorMessage);
		});

		test.skipIf(version === 7)('arbitrary extension should not work', async () => {
			await using fixture = await createFixture({
				'node_modules/dep/tsconfig.ts': createTsconfigJson({
					compilerOptions: {
						strict: true,
						jsx: 'react-native'
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/tsconfig.ts'
				}),
				'file.ts': ''
			});

			const errorMessage = 'File \'dep/tsconfig.ts\' not found';
			await expect(
				getTscTsconfig(fixture.path)
			).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
			expect(() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })).toThrow(errorMessage);
		});
	});

	test('directory named "tsconfig.json"', async () => {
		await using fixture = await createFixture({
			'node_modules/dep/tsconfig.json/tsconfig.json': createTsconfigJson({
				compilerOptions: {
					strict: true,
					jsx: 'react'
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: 'dep/tsconfig.json'
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	test('extends dependency package far', async () => {
		await using fixture = await createFixture({
			'node_modules/dep/tsconfig.json': createTsconfigJson({
				compilerOptions: {
					strict: true,
					jsx: 'react'
				}
			}),
			'nested/nested/nested': {
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/tsconfig.json'
				}),
				'file.ts': ''
			}
		});

		const fixturePath = fixture.getPath('nested/nested/nested');
		const expectedTsconfig = await getTscTsconfig(fixturePath, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(path.join(fixturePath, 'tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	// https://github.com/privatenumber/get-tsconfig/issues/76
	test('resolves config in parent node_modules', async () => {
		await using fixture = await createFixture({
			library: {
				src: {
					'a.ts': '',
					'b.ts': '',
					'c.ts': ''
				},
				'tsconfig.json': createTsconfigJson({
					extends: '@monorepo/tsconfig/tsconfig.base.json',
					include: ['src']
				})
			},

			'node_modules/@monorepo/tsconfig': {
				'tsconfig.base.json': createTsconfigJson({
					compilerOptions: {
						module: 'esnext'
					}
				})
			}
		});

		const originalCwd = process.cwd();
		try {
			process.chdir(fixture.getPath('library'));
			const expectedTsconfig = await getTscTsconfig('.', undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig('./tsconfig.json', { typeScriptVersion: version });

			expect(tsconfig.compilerOptions).toStrictEqual({ module: 'esnext' });
			expect(tsconfig.include).toStrictEqual(expectedTsconfig.include);
		} finally {
			process.chdir(originalCwd);
		}
	});

	describe('scoped package', () => {
		test('nested subpath', async () => {
			await using fixture = await createFixture({
				'node_modules/@scope/pkg': {
					'configs/base.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'react-jsx'
						}
					}),
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: '@scope/pkg/configs/base.json'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
			expect(tsconfig.compilerOptions).toStrictEqual({ jsx: 'react-jsx' });
		});

		test('exports subpath', async () => {
			await using fixture = await createFixture({
				'node_modules/@scope/pkg': {
					'package.json': createPackageJson({
						exports: { './config': './configs/some-config.json' }
					}),
					'configs/some-config.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'react-jsx'
						}
					}),
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: '@scope/pkg/config'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
			expect(tsconfig.compilerOptions).toStrictEqual({ jsx: 'react-jsx' });
		});
	});

	test('resolves dependency of symlinked package in pnpm-style node_modules', async () => {
		await using fixture = await createFixture({
			node_modules: {
				'.pnpm': {
					'shared-config@1.0.0/node_modules': {
						'shared-config': {
							'package.json': createPackageJson({
								name: 'shared-config',
								version: '1.0.0'
							}),
							'tsconfig.json': createTsconfigJson({
								extends: 'base-config',
								compilerOptions: {
									jsx: 'react'
								}
							})
						},
						'base-config': ({ symlink }) => symlink('../../base-config@1.0.0/node_modules/base-config', 'dir')
					},
					'base-config@1.0.0/node_modules/base-config': {
						'package.json': createPackageJson({
							name: 'base-config',
							version: '1.0.0'
						}),
						'tsconfig.json': createTsconfigJson({
							compilerOptions: {
								strict: true,
								allowJs: true
							}
						})
					}
				},
				'shared-config': ({ symlink }) => symlink('./.pnpm/shared-config@1.0.0/node_modules/shared-config', 'dir')
			},
			'tsconfig.json': createTsconfigJson({
				extends: 'shared-config'
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	test('resolves dependency from the apparent location of a symlinked project directory', async () => {
		await using fixture = await createFixture({
			'real/project': {
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			},
			apparent: {
				'node_modules/dep/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react',
						strict: true
					}
				}),
				project: ({ symlink }) => symlink('../real/project', 'dir')
			}
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, 'apparent/project', version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('apparent/project/tsconfig.json'), { typeScriptVersion: version });

		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	test('prefers dependency at the apparent location of a symlinked project directory', async () => {
		await using fixture = await createFixture({
			real: {
				'node_modules/dep/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'preserve'
					}
				}),
				project: {
					'tsconfig.json': createTsconfigJson({
						extends: 'dep'
					}),
					'file.ts': ''
				}
			},
			apparent: {
				'node_modules/dep/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react'
					}
				}),
				project: ({ symlink }) => symlink('../real/project', 'dir')
			}
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, 'apparent/project', version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('apparent/project/tsconfig.json'), { typeScriptVersion: version });

		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});

	test.skipIf(version === 7)('does not resolve dependency from the apparent location of a symlinked package', async () => {
		await using fixture = await createFixture({
			'linked/shared-config/tsconfig.json': createTsconfigJson({
				extends: 'dep'
			}),
			project: {
				'node_modules/dep/tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react'
					}
				}),
				'node_modules/shared-config': ({ symlink }) => symlink('../../linked/shared-config', 'dir'),
				'tsconfig.json': createTsconfigJson({
					extends: 'shared-config'
				}),
				'file.ts': ''
			}
		});

		const errorMessage = 'File \'dep\' not found';
		await expect(
			getTscTsconfig(fixture.path, 'project')
		).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
		expect(() => parseTsconfig(fixture.getPath('project/tsconfig.json'), { typeScriptVersion: version })).toThrow(errorMessage);
	});

	describe('package.json#tsconfig', () => {
		test('package.json#tsconfig', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						tsconfig: './some-config.json'
					}),
					'some-config.json': createTsconfigJson({
						compilerOptions: {
							strict: true,
							jsx: 'react'
						}
					}),

					// should be ignored
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(expectedTsconfig).toStrictEqual(tsconfig);
		});

		test('reads nested package.json#tsconfig', async () => {
			await using fixture = await createFixture({
				'node_modules/dep/some-directory': {
					'package.json': createPackageJson({
						// This is ignored because its not at root
						exports: {
							'./*': null
						},
						tsconfig: './some-config.json'
					}),
					'some-config.json': createTsconfigJson({
						compilerOptions: {
							strict: true,
							jsx: 'react'
						}
					}),

					// should be ignored
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/some-directory'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(expectedTsconfig).toStrictEqual(tsconfig);
		});
	});

	describe('package.json exports', () => {
		test('main', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						exports: './some-config.json'
					}),
					'some-config.json': createTsconfigJson({
						compilerOptions: {
							strict: true,
							jsx: 'react'
						}
					}),

					// should be ignored
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(expectedTsconfig).toStrictEqual(tsconfig);
		});

		test('subpath', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						exports: { './config': './some-config.json' }
					}),
					'some-config.json': createTsconfigJson({
						compilerOptions: {
							strict: true,
							jsx: 'react'
						}
					}),

					// should be ignored
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/config'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(expectedTsconfig).toStrictEqual(tsconfig);
		});

		describe('conditions', () => {
			test.skipIf(version === 7)('import should fail', async () => {
				await using fixture = await createFixture({
					'node_modules/dep': {
						'package.json': createPackageJson({
							exports: {
								import: './some-config.json'
							}
						}),
						'some-config.json': createTsconfigJson({
							compilerOptions: {
								strict: true,
								jsx: 'react'
							}
						}),

						// should be ignored
						'tsconfig.json': createTsconfigJson({
							compilerOptions: {
								jsx: 'preserve'
							}
						})
					},
					'tsconfig.json': createTsconfigJson({
						extends: 'dep'
					}),
					'file.ts': ''
				});

				const errorMessage = 'File \'dep\' not found.';
				await expect(
					getTscTsconfig(fixture.path)
				).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
				expect(
					() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
				).toThrow(errorMessage);
			});

			test('prefers require over import', async () => {
				await using fixture = await createFixture({
					'node_modules/dep': {
						'package.json': createPackageJson({
							exports: {
								import: './import.json',
								require: './require.json'
							}
						}),
						'import.json': createTsconfigJson({
							compilerOptions: {
								jsx: 'react'
							}
						}),
						'require.json': createTsconfigJson({
							compilerOptions: {
								jsx: 'react-native'
							}
						})
					},
					'tsconfig.json': createTsconfigJson({
						extends: 'dep'
					}),
					'file.ts': ''
				});

				const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
				delete expectedTsconfig.files;

				const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
				expect(tsconfig).toStrictEqual(expectedTsconfig);
				expect(tsconfig.compilerOptions).toStrictEqual({ jsx: 'react-native' });
			});

			test('types', async () => {
				await using fixture = await createFixture({
					'node_modules/dep': {
						'package.json': createPackageJson({
							exports: {
								types: './some-config.json'
							}
						}),
						'some-config.json': createTsconfigJson({
							compilerOptions: {
								strict: true,
								jsx: 'react'
							}
						}),

						// should be ignored
						'tsconfig.json': createTsconfigJson({
							compilerOptions: {
								jsx: 'preserve'
							}
						})
					},
					'tsconfig.json': createTsconfigJson({
						extends: 'dep'
					}),
					'file.ts': ''
				});

				const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
				delete expectedTsconfig.files;

				const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

				expect(expectedTsconfig).toStrictEqual(tsconfig);
			});

			test.skipIf(version === 7)('missing condition should fail', async () => {
				await using fixture = await createFixture({
					'node_modules/dep': {
						'package.json': createPackageJson({
							exports: {
								asdf: './some-config.json'
							}
						}),
						'some-config.json': createTsconfigJson({
							compilerOptions: {
								strict: true,
								jsx: 'react'
							}
						}),

						// should be ignored
						'tsconfig.json': createTsconfigJson({
							compilerOptions: {
								jsx: 'preserve'
							}
						})
					},
					'tsconfig.json': createTsconfigJson({
						extends: 'dep'
					}),
					'file.ts': ''
				});

				const errorMessage = 'File \'dep\' not found.';
				await expect(
					getTscTsconfig(fixture.path)
				).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
				expect(
					() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
				).toThrow(errorMessage);
			});
		});

		test.skipIf(version === 7)('missing subpath should fail', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						exports: {
							'./config': './some-config.json'
						}
					}),
					'some-config.json': createTsconfigJson({
						compilerOptions: {
							strict: true,
							jsx: 'react'
						}
					}),

					// should be ignored
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'preserve'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/missing'
				}),
				'file.ts': ''
			});

			const errorMessage = 'File \'dep/missing\' not found.';
			await expect(
				getTscTsconfig(fixture.path)
			).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow(errorMessage);
		});

		// Seems like a TypeScript bug
		test('null exports should resolve tsconfig.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						exports: null
					}),

					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'react-native'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test('null exports should resolve tsconfig.json in directory', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						exports: null
					}),

					'some-directory/tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'react-jsx'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/some-directory'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
			expect(tsconfig).toStrictEqual(expectedTsconfig);
		});

		test.skipIf(version === 7)('path block should not resolve tsconfig.json', async () => {
			await using fixture = await createFixture({
				'node_modules/dep': {
					'package.json': createPackageJson({
						exports: {
							'./*': null
						}
					}),

					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'react-native'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep'
				}),
				'file.ts': ''
			});

			const errorMessage = 'File \'dep\' not found.';
			await expect(
				getTscTsconfig(fixture.path)
			).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow(errorMessage);
		});

		test('package.json ignored in nested directory', async () => {
			await using fixture = await createFixture({
				'node_modules/dep/a': {
					'package.json': createPackageJson({
						exports: {
							'./*': null
						}
					}),
					'tsconfig.json': createTsconfigJson({
						compilerOptions: {
							jsx: 'react-native'
						}
					})
				},
				'tsconfig.json': createTsconfigJson({
					extends: 'dep/a'
				}),
				'file.ts': ''
			});

			const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
			delete expectedTsconfig.files;

			const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

			expect(expectedTsconfig).toStrictEqual(tsconfig);
		});
	});
});
