import { expect, describe, test } from 'vitest';
import type { PathConditions } from '../../../../../../src/utils/tsconfig-parser/utils/resolve-exports';
import { createFixture } from '../../../../utils/fixture';
import { createTsconfigJson, createPackageJson } from '../../../../utils/fixture-helpers';
import { getTscTsconfig, typescriptVersions } from '../../../../utils/typescript-helpers';
import { parseTsconfig } from '../../../../../../src/utils/tsconfig-parser';

const notFound = 'not found';

// TS 6 reports TS6053 for an unresolvable `extends`; TS 7 `--showConfig` silently drops it
const getTscJsx = async (cwd: string, version: 6 | 7) => {
	try {
		return (await getTscTsconfig(cwd, undefined, version)).compilerOptions?.jsx ?? notFound;
	} catch (error) {
		if ((error as { stdout?: string }).stdout?.includes('error TS6053')) { return notFound }

		throw error;
	}
};

const getLibraryJsx = (tsconfigPath: string, version: 6 | 7) => {
	try {
		return parseTsconfig(tsconfigPath, { typeScriptVersion: version }).compilerOptions?.jsx;
	} catch (error) {
		if ((error as Error).message.includes('not found')) { return notFound }

		throw error;
	}
};

const createExportsFixture = (exports: PathConditions) => createFixture({
	'node_modules/dep': {
		'package.json': createPackageJson({ exports }),
		'a.json': createTsconfigJson({ compilerOptions: { jsx: 'react' } }),
		'tsconfig.json': createTsconfigJson({ compilerOptions: { jsx: 'preserve' } })
	},
	'tsconfig.json': createTsconfigJson({ extends: 'dep' }),
	'file.ts': ''
});

describe.each(typescriptVersions)('exports targets (TypeScript %i)', (version) => {
	describe('null target within the exports map is terminal', () => {
		test.each([
			[ 'conditional null before default', { '.': { require: null, default: './a.json' } } ],
			[ 'nested conditional null before default', { '.': { node: { require: null }, default: './a.json' } } ]
		])('%s', async (_, exports) => {
			await using fixture = await createExportsFixture(exports);

			expect(await getTscJsx(fixture.path, version)).toBe(notFound);
			expect(getLibraryJsx(fixture.getPath('tsconfig.json'), version)).toBe(notFound);
		});
	});

	describe('known divergences from tsc', () => {
		// tsc treats null as terminal inside arrays; resolveExports skips it like Node.js does
		test.each([
			[ 'null array entry', [ null, './a.json' ] ],
			[ 'conditional null in array entry', [ { require: null }, './a.json' ] ]
		])('%s', async (_, exports) => {
			await using fixture = await createExportsFixture(exports as PathConditions);

			expect(await getTscJsx(fixture.path, version)).toBe(notFound);
			expect(getLibraryJsx(fixture.getPath('tsconfig.json'), version)).toBe('react');
		});

		// tsc tries each array target until one exists; the library only uses the first
		test('array fallback past a missing file', async () => {
			await using fixture = await createExportsFixture([ './missing.json', './a.json' ]);

			expect(await getTscJsx(fixture.path, version)).toBe('react');
			expect(getLibraryJsx(fixture.getPath('tsconfig.json'), version)).toBe('preserve');
		});

		// tsc skips an invalid array target; resolveExports throws, which blocks resolution
		test('array fallback past an invalid target', async () => {
			await using fixture = await createExportsFixture([ '../x.json', './a.json' ]);

			expect(await getTscJsx(fixture.path, version)).toBe('react');
			expect(getLibraryJsx(fixture.getPath('tsconfig.json'), version)).toBe(notFound);
		});

		// tsc falls through to `default` when a matched nested condition has no match; resolveExports stops
		test('unmatched nested condition before default', async () => {
			await using fixture = await createExportsFixture({ '.': { node: { import: './b.json' }, default: './a.json' } });

			expect(await getTscJsx(fixture.path, version)).toBe('react');
			expect(getLibraryJsx(fixture.getPath('tsconfig.json'), version)).toBe(notFound);
		});
	});

	test('array fallback past an unmatched condition', async () => {
		await using fixture = await createExportsFixture([ { asdf: './missing.json' }, './a.json' ]);

		expect(await getTscJsx(fixture.path, version)).toBe('react');
		expect(getLibraryJsx(fixture.getPath('tsconfig.json'), version)).toBe('react');
	});
});
