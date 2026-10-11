export type TypeScriptVersion = 6 | 7;

export type TypeScriptSemanticsConfiguration = {
	readonly node10ModuleResolution: 'node10' | 'node';
	readonly removedCompilerOptions: readonly string[];
	readonly removedTargets: readonly string[];
	readonly removedModules: readonly string[];
	readonly baseUrlResolution: boolean;
	readonly alwaysRejectNonRelativeSubstitutions: boolean;
	readonly exactMatchStripsWildcard: boolean;
};

export const defaultTypeScriptVersion: TypeScriptVersion = 6;

const typescriptSemantics: Readonly<Record<TypeScriptVersion, TypeScriptSemanticsConfiguration>> = Object.freeze({
	6: Object.freeze({
		node10ModuleResolution: 'node10',
		removedCompilerOptions: Object.freeze([]),
		removedTargets: Object.freeze([]),
		removedModules: Object.freeze([]),
		baseUrlResolution: true,
		alwaysRejectNonRelativeSubstitutions: false,
		exactMatchStripsWildcard: false
	}),
	7: Object.freeze({
		node10ModuleResolution: 'node',
		removedCompilerOptions: Object.freeze([
			'out',
			'charset',
			'keyofStringsOnly',
			'suppressImplicitAnyIndexErrors',
			'noImplicitUseStrict',
			'noStrictGenericChecks',
			'preserveValueImports',
			'importsNotUsedAsValues',
			'plugins'
		]),
		removedTargets: Object.freeze(['es3']),
		removedModules: Object.freeze(['none']),
		baseUrlResolution: false,
		alwaysRejectNonRelativeSubstitutions: true,
		exactMatchStripsWildcard: true
	})
});

/**
 * Returns the frozen semantics table entry for a TypeScript major version.
 * @param version - TypeScript major version.
 * @returns The semantics for `version`.
 */
export const getTypeScriptSemantics = (version: TypeScriptVersion = defaultTypeScriptVersion): TypeScriptSemanticsConfiguration => {
	if (!Object.hasOwn(typescriptSemantics, version)) { throw new TypeError(`Unsupported TypeScript version: ${String(version)}`) }

	return typescriptSemantics[version];
};
