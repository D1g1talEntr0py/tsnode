import path from 'node:path';
import { expect, describe, test } from 'vitest';
import { createFixture } from '../../../../utils/fixture';
import { createTsconfigJson } from '../../../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../../../utils/typescript-helpers';
import { parseTsconfig, type TypeScriptVersion } from '../../../../../../src/utils/tsconfig-parser';

const validate = async (directoryPath: string, version: TypeScriptVersion) => {
	const expectedTsconfig = await getTscTsconfig(directoryPath, undefined, version);
	delete expectedTsconfig.files;

	const tsconfig = parseTsconfig(path.join(directoryPath, 'tsconfig.json'), { typeScriptVersion: version });

	expect(expectedTsconfig).toStrictEqual(tsconfig);
};

describe.each(typescriptVersions)('symbolic link (TypeScript %i)', (version) => {
	test('extends symlink to file', async () => {
		await using fixture = await createFixture({
			'tsconfig.symlink-source.json': createTsconfigJson({
				compilerOptions: {
					jsx: 'react',
					allowJs: true
				}
			}),
			'tsconfig.json': createTsconfigJson({
				extends: './tsconfig.symlink.json',
				compilerOptions: {
					strict: true
				}
			}),
			'file.ts': '',
			'tsconfig.symlink.json': ({ symlink }) => symlink('./tsconfig.symlink-source.json')
		});

		await validate(fixture.path, version);
	});

	test('extends file from symlink to directory', async () => {
		await using fixture = await createFixture({
			'symlink-source': {
				'tsconfig.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react',
						allowJs: true
					}
				})
			},
			'tsconfig.json': createTsconfigJson({
				extends: './symlink/tsconfig.json',
				compilerOptions: {
					strict: true
				}
			}),
			'file.ts': '',
			symlink: ({ symlink }) => symlink('./symlink-source')
		});

		await validate(fixture.path, version);
	});

	test('extends from symlink to file in origin directory', async () => {
		await using fixture = await createFixture({
			'symlink-source': {
				'tsconfig.main.json': createTsconfigJson({
					extends: './tsconfig.base.json',
					compilerOptions: {
						strict: true
					}
				})
			},
			project: {
				'tsconfig.base.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react',
						allowJs: true
					}
				}),
				'file.ts': '',
				'tsconfig.json': ({ symlink }) => symlink('../symlink-source/tsconfig.main.json')
			}
		});

		await validate(fixture.getPath('project'), version);
	});

	test('extends from file in symlinked directory to file in origin directory', async () => {
		await using fixture = await createFixture({
			'symlink-source': {
				'tsconfig.main.json': createTsconfigJson({
					extends: '../tsconfig.base.json',
					compilerOptions: {
						strict: true
					}
				})
			},
			project: {
				'tsconfig.base.json': createTsconfigJson({
					compilerOptions: {
						jsx: 'react',
						allowJs: true
					}
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './symlink/tsconfig.main.json',
					compilerOptions: {
						importHelpers: true
					}
				}),
				'file.ts': '',
				symlink: ({ symlink }) => symlink('../symlink-source')
			}
		});

		await validate(fixture.getPath('project'), version);
	});
});
