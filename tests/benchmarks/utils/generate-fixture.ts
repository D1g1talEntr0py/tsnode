import type { FileTree } from 'fs-fixture';

export type SpecifierStyle = 'ts' | 'js' | 'extensionless';
export type NonErasableSyntax = 'enum' | 'namespace' | 'decorator';

const specifierByStyle: Record<SpecifierStyle, (moduleName: string) => string> = {
	ts: moduleName => `./${moduleName}.ts`,
	js: moduleName => `./${moduleName}.js`,
	extensionless: moduleName => `./${moduleName}`,
};

/**
 * A module records a high-resolution timestamp when its body first evaluates.
 * ESM evaluates post-order, so the earliest timestamp marks "graph fully
 * loaded/transformed" and the entry's final timestamp marks "graph fully
 * evaluated" — letting the runner split load vs eval time.
 */
const evalMark = '(globalThis.__bench ??= []).push(performance.now());';

/**
 * Printed as the last stdout line by every scenario entry. The runner parses it.
 * maxRSS is kilobytes (Node normalizes `resourceUsage().maxRSS` to KB).
 */
export const metricsReporter = `{
	const __t = globalThis.__bench ?? [];
	const __now = performance.now();
	console.log('__BENCH__' + JSON.stringify({
		first: __t.length > 0 ? Math.min(...__t) : __now,
		last: __now,
		maxRssKb: process.resourceUsage().maxRSS,
	}));
}`;

const childrenOf = (index: number, moduleCount: number) => (
	[(index * 3) + 1, (index * 3) + 2, (index * 3) + 3].filter(child => child < moduleCount)
);

const createTree = (
	moduleCount: number,
	specifierStyle: SpecifierStyle,
	createModule: (index: number, valueExpression: string) => string,
): FileTree => {
	const toSpecifier = specifierByStyle[specifierStyle];
	const files: FileTree = {};

	for (let i = 0; i < moduleCount; i += 1) {
		const children = childrenOf(i, moduleCount);
		const imports = children.map(
			(child, index) => `import { value as v${index} } from '${toSpecifier(`module-${child}`)}';`,
		).join('\n');
		const valueExpression = children.length > 0 ? children.map((_, index) => `v${index}`).join(' + ') : '1';
		files[`module-${i}.ts`] = `${imports}\n${evalMark}\n${createModule(i, valueExpression)}\n`;
	}

	files['main.ts'] = `import { value } from '${toSpecifier('module-0')}';\nconsole.log('total', value);\n${metricsReporter}\n`;
	return files;
};

/**
 * A tree of TypeScript modules, each importing up to 3 children (ESM import).
 * `specifierStyle` controls how children are referenced, exercising different
 * resolution paths. Mirrors the shape reported in
 * https://github.com/privatenumber/tsx/issues/809
 */
export const esmTree = (
	moduleCount: number,
	specifierStyle: SpecifierStyle,
): FileTree => createTree(moduleCount, specifierStyle, (_index, valueExpression) => `type Value = number;\nexport const value: Value = ${valueExpression};`);

const createNonErasableModule = (syntax: NonErasableSyntax, index: number, valueExpression: string) => {
	switch (syntax) {
		case 'enum':
			return `enum Value${index} { current = ${valueExpression} }\nexport const value = Value${index}.current;`;
		case 'namespace':
			return `namespace Value${index} {\n\texport const current = ${valueExpression};\n}\nexport const value = Value${index}.current;`;
		case 'decorator':
			return `const identity = <T extends new (...args: never[]) => { current: number }>(klass: T) => klass;\n@identity\nclass Value${index} {\n\tcurrent: number = ${valueExpression};\n}\nexport const value = new Value${index}().current;`;
	}
	};

export const nonErasableTsTree = (
	moduleCount: number,
	specifierStyle: SpecifierStyle,
	syntax: NonErasableSyntax,
): FileTree => createTree(moduleCount, specifierStyle, (index, valueExpression) => createNonErasableModule(syntax, index, valueExpression));

export const mixedTsTree = (
	moduleCount: number,
	specifierStyle: SpecifierStyle,
	options: { syntax: NonErasableSyntax; fallbackEvery: number },
): FileTree => createTree(moduleCount, specifierStyle, (index, valueExpression) => (
	index % options.fallbackEvery === 0
		? createNonErasableModule(options.syntax, index, valueExpression)
		: `type Value = number;\nexport const value: Value = ${valueExpression};`
));

/**
 * Same tree shape as `esmTree`, but plain JavaScript (no types). Used to
 * measure hook registration + pass-through resolve/load with zero transforms.
 */
export const jsTree = (
	moduleCount: number,
): FileTree => {
	const files: FileTree = {};
	const toSpecifier = specifierByStyle.js;

	for (let i = 0; i < moduleCount; i += 1) {
		const children = childrenOf(i, moduleCount);
		const imports = children.map(
			(child, index) => `import { value as v${index} } from '${toSpecifier(`module-${child}`)}';`,
		).join('\n');
		const value = children.length > 0 ? children.map((_, index) => `v${index}`).join(' + ') : '1';
		files[`module-${i}.js`] = `${imports}\n${evalMark}\nexport const value = ${value};\n`;
	}

	files['main.js'] = `import { value } from '${toSpecifier('module-0')}';\nconsole.log('total', value);\n${metricsReporter}\n`;
	return files;
};

const baseCompilerOptions = {
	module: 'ESNext',
	moduleResolution: 'Bundler',
	allowImportingTsExtensions: true,
	allowJs: true,
	noEmit: true,
};

export const createTsconfigForTree = (compilerOptions?: Record<string, unknown>): FileTree => ({
	'tsconfig.json': JSON.stringify({
		compilerOptions: {
			...baseCompilerOptions,
			...compilerOptions,
		},
	}),
});

export const tsconfigForTree: FileTree = createTsconfigForTree();
