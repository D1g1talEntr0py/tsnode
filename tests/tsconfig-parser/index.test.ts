import { test, expect } from 'vitest';
import { createFixture } from './utils/fixture';
import { createTsconfigJson } from './utils/fixture-helpers';
import { getTscResolution, typescriptVersions } from './utils/typescript-helpers';
import { createPathsMatcher } from '../../src/utils/tsconfig-parser';
import { getTsconfig } from './utils/fixture-helpers';


test.for(typescriptVersions)('paths > prefix match > nested directory (TypeScript %i)', async (version) => {
	await using fixture = await createFixture({
		'dir/tsconfig.json': createTsconfigJson({
			compilerOptions: {
				paths: {
					'@/*': ['./*']
				}
			}
		})
	});

	const cwd = process.cwd();

	try {
		process.chdir(fixture.path);

		const tsconfig = getTsconfig('./dir/tsconfig.json', { typeScriptVersion: version });
		expect(tsconfig).not.toBeNull();

		const matcher = createPathsMatcher(tsconfig!, { typeScriptVersion: version })!;
		expect(matcher).not.toBeNull();

		const resolvedAttempts = await getTscResolution('@/file', fixture.getPath('./dir'), version);
		expect(matcher('@/file')).toStrictEqual([
			resolvedAttempts[0]!.filePath.slice(0, -3)
		]);
	} finally {
		process.chdir(cwd);
	}
});
