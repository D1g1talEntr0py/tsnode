import { expect, describe, test } from 'vitest';
import { createFixture } from '../../../../utils/fixture';
import { createTsconfigJson } from '../../../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../../../utils/typescript-helpers';
import { parseTsconfig } from '../../../../../../src/utils/tsconfig-parser';

describe.each(typescriptVersions)('absolute path (TypeScript %i)', (version) => {
	test('absolute path', async () => {
		await using fixture = await createFixture({
			'dep/tsconfig.json': createTsconfigJson({
				compilerOptions: {
					strict: true,
					jsx: 'react'
				}
			}),
			'tsconfig.json': ({ getPath }) => createTsconfigJson({
				extends: getPath('dep/tsconfig.json')
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});

	test('no extension', async () => {
		await using fixture = await createFixture({
			'dep/tsconfig.json': createTsconfigJson({
				compilerOptions: {
					strict: true,
					jsx: 'react'
				}
			}),
			'tsconfig.json': ({ getPath }) => createTsconfigJson({
				extends: getPath('dep/tsconfig')
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
			'dep/tsconfig.tsx': createTsconfigJson({
				compilerOptions: {
					strict: true,
					jsx: 'react'
				}
			}),
			'tsconfig.json': ({ getPath }) => createTsconfigJson({
				extends: getPath('dep/tsconfig.tsx')
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });

		expect(expectedTsconfig).toStrictEqual(tsconfig);
	});
});
