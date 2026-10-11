import { expect, describe, test } from 'vitest';
import { defaultTypeScriptVersion, getTypeScriptSemantics } from '../../../src/utils/tsconfig-parser/utils/typescript-semantics';
import type { TypeScriptVersion } from '../../../src/utils/tsconfig-parser';

describe('getTypeScriptSemantics', () => {
	test('defaults to TypeScript 6', () => {
		expect(defaultTypeScriptVersion).toBe(6);
		expect(getTypeScriptSemantics()).toBe(getTypeScriptSemantics(6));
	});

	test('TypeScript 6', () => {
		expect(getTypeScriptSemantics(6)).toStrictEqual({
			node10ModuleResolution: 'node10',
			removedCompilerOptions: [],
			removedTargets: [],
			removedModules: [],
			baseUrlResolution: true,
			alwaysRejectNonRelativeSubstitutions: false,
			exactMatchStripsWildcard: false
		});
	});

	test('TypeScript 7', () => {
		expect(getTypeScriptSemantics(7)).toStrictEqual({
			node10ModuleResolution: 'node',
			removedCompilerOptions: [
				'out',
				'charset',
				'keyofStringsOnly',
				'suppressImplicitAnyIndexErrors',
				'noImplicitUseStrict',
				'noStrictGenericChecks',
				'preserveValueImports',
				'importsNotUsedAsValues',
				'plugins'
			],
			removedTargets: ['es3'],
			removedModules: ['none'],
			baseUrlResolution: false,
			alwaysRejectNonRelativeSubstitutions: true,
			exactMatchStripsWildcard: true
		});
	});

	test.each([6, 7] as const)('TypeScript %i table is deeply frozen', (version) => {
		const semantics = getTypeScriptSemantics(version);
		expect(Object.isFrozen(semantics)).toBe(true);
		expect(Object.isFrozen(semantics.removedCompilerOptions)).toBe(true);
		expect(Object.isFrozen(semantics.removedTargets)).toBe(true);
		expect(Object.isFrozen(semantics.removedModules)).toBe(true);
	});

	test.each([5, 8, 'toString'])('rejects unsupported version %s', (version) => {
		expect(() => getTypeScriptSemantics(version as unknown as TypeScriptVersion)).toThrow(TypeError);
	});
});
