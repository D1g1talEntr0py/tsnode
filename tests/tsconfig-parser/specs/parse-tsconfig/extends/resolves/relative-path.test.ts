import path from 'node:path';
import { expect, describe, test } from 'vitest';
import { createFixture } from '../../../../utils/fixture';
import { createTsconfigJson, createPackageJson } from '../../../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../../../utils/typescript-helpers';
import { parseTsconfig } from '../../../../../../src/utils/tsconfig-parser';

describe.each(typescriptVersions)('relative path (TypeScript %i)', (version) => {
	test('extensionless file', async () => {
		await using fixture = await createFixture({
			asdf: createTsconfigJson({
				compilerOptions: {
					jsx: 'react',
					allowJs: true
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './asdf',
				compilerOptions: {
					strict: true
				}
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	test('prefers exact match (extensionless file)', async () => {
		await using fixture = await createFixture({
			asdf: createTsconfigJson({
				compilerOptions: {
					jsx: 'react',
					allowJs: true
				}
			}),
			'asdf.json': createTsconfigJson({
				compilerOptions: {
					jsx: 'react-native',
					allowJs: true
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './asdf',
				compilerOptions: {
					strict: true
				}
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	test('arbitrary extension', async () => {
		await using fixture = await createFixture({
			'asdf.ts': createTsconfigJson({
				compilerOptions: {
					jsx: 'react',
					allowJs: true
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './asdf.ts',
				compilerOptions: {
					strict: true
				}
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	test('parent directory', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': createTsconfigJson({
				compilerOptions: {
					jsx: 'react',
					allowJs: true
				}
			}),
			tests: {
				'tsconfig.json': createTsconfigJson({
					extends: '..',
					compilerOptions: {
						strict: true
					}
				}),
				'file.ts': ''
			}
		});

		const testDirectory = fixture.getPath('tests/');
		const expectedTsconfig = await getTscTsconfig(testDirectory, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(path.join(testDirectory, 'tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	test('should not resolve directory', async () => {
		await using fixture = await createFixture({
			'directory/tsconfig.json': createTsconfigJson({
				compilerOptions: {
					jsx: 'react'
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './directory'
			})
		});

		expect(
			() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
		).toThrow('File \'./directory\' not found.');
	});

	test('should not resolve directory even with package.json#tsconfig', async () => {
		await using fixture = await createFixture({
			directory: {
				'package.json': createPackageJson({
					tsconfig: './tsconfig.json'
				}),
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react'
					}
				})
			},
			'tsconfig.json': createTsconfigJson({
				extends: './directory'
			})
		});

		expect(
			() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
		).toThrow('File \'./directory\' not found.');
	});

	test('outDir in extends', async () => {
		await using fixture = await createFixture({
			'a/dep.json': createTsconfigJson({
				compilerOptions: {
					jsx: 'react-native',
					outDir: 'dist'
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

	test('rootDir in extends', async () => {
		await using fixture = await createFixture({
			'a/dep.json': createTsconfigJson({
				compilerOptions: {
					rootDir: 'src'
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

	test('rootDirs in extends', async () => {
		await using fixture = await createFixture({
			'a/dep.json': createTsconfigJson({
				compilerOptions: {
					rootDirs: ['src', 'generated']
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

	test('typeRoots in extends', async () => {
		await using fixture = await createFixture({
			'a/dep.json': createTsconfigJson({
				compilerOptions: {
					typeRoots: ['types']
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
