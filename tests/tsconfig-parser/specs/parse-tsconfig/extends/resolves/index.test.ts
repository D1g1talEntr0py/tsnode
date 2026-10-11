import { expect, describe, test } from 'vitest';
import { createFixture } from '../../../../utils/fixture';
import { createTsconfigJson } from '../../../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../../../utils/typescript-helpers';
import { parseTsconfig } from '../../../../../../src/utils/tsconfig-parser';

describe.each(typescriptVersions)('resolves (TypeScript %i)', (version) => {
	test('handles missing extends', async () => {
		await using fixture = await createFixture({
			'file.ts': '',
			'tsconfig.json': createTsconfigJson({
				extends: 'missing-package'
			})
		});

		expect(
			() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
		).toThrow('File \'missing-package\' not found.');
	});

	describe('circularity', () => {
		test.skipIf(version === 7)('self extend', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': createTsconfigJson({
					extends: './tsconfig.json'
				}),
				'file.ts': ''
			});

			const errorMessage = 'Circularity detected while resolving configuration';
			await expect(
				getTscTsconfig(fixture.path)
			).rejects.toHaveProperty('stdout', expect.stringContaining(errorMessage));
			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow(errorMessage);
		});

		test('recursive', async () => {
			await using fixture = await createFixture({
				'base.json': createTsconfigJson({
					extends: './tsconfig.json'
				}),
				'tsconfig.json': createTsconfigJson({
					extends: './base.json'
				})
			});

			expect(
				() => parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version })
			).toThrow('Circularity detected while resolving configuration:');
		});
	});

	test('extends array with common base', async () => {
		await using fixture = await createFixture({
			'base.json': createTsconfigJson({}),
			'tsconfig-b.json': createTsconfigJson({
				extends: './base.json'
			}),
			'tsconfig-a.json': createTsconfigJson({
				extends: './base.json'
			}),
			'tsconfig.json': createTsconfigJson({
				extends: [
					'./tsconfig-a.json',
					'./tsconfig-b.json'
				]
			}),
			'file.ts': ''
		});

		const expectedTsconfig = await getTscTsconfig(fixture.path, undefined, version);
		delete expectedTsconfig.files;

		const tsconfig = parseTsconfig(fixture.getPath('tsconfig.json'), { typeScriptVersion: version });
		expect(tsconfig).toStrictEqual(expectedTsconfig);
	});
});
