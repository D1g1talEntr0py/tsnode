import { describe, expect, test } from 'vitest';
import { createData } from '../src/hook/initialize';
import { createLoadSync } from '../src/hook/load';

const importFromSource = async (source: string) => {
	const encoded = Buffer.from(source, 'utf-8').toString('base64');
	return import(`data:text/javascript;base64,${encoded}`);
};

describe('hook load', () => {
	test.each(['ts', 'tsx'])('transforms fragmented .%s URLs reported as module', async (extension) => {
		const load = createLoadSync(createData({ tsconfig: false }));
		const source = extension === 'tsx' ? 'const React = { createElement: () => 42 }; export const answer = <div />;' : 'export const answer: number = 42;';
		const result = load(`file:///project/probe.${extension}#fragment`, {} as never, () => ({ format: 'module', source }));

		const imported = await importFromSource(result.source as string);
		expect(imported.answer).toBe(42);
	});

	test('transforms inline decorators rather than leaving them for Node', async () => {
		const load = createLoadSync(createData({ tsconfig: false }));
		const source = 'function mark(value) { value.marked = true; } function make() { @mark class C {} return C; } export const marked = make().marked;';
		const result = load('file:///project/decorator.ts', {} as never, () => ({ format: 'module', source }));

		const imported = await importFromSource(result.source as string);
		expect(imported.marked).toBe(true);
	});

	test('uses native stripping for erasable TypeScript syntax', async () => {
		const load = createLoadSync(createData({ tsconfig: false }));
		const result = load(
			'file:///project/simple.ts',
			{} as never,
			() => ({ format: 'module-typescript', source: 'const value: number = 1; export const answer: number = value + 1;' }),
		);

		expect(result.format).toBe('module');
		expect(result.source).not.toContain('sourceMappingURL');
		const imported = await importFromSource(result.source as string);
		expect(imported.answer).toBe(2);
	});

	test('falls back to esbuild for non-erasable TypeScript syntax', async () => {
		const load = createLoadSync(createData({ tsconfig: false }));
		const result = load(
			'file:///project/complex.ts',
			{} as never,
			() => ({ format: 'module-typescript', source: 'enum Color { Red = "red" } export const color = Color.Red;' }),
		);

		expect(result.format).toBe('module');
		const imported = await importFromSource(result.source as string);
		expect(imported.color).toBe('red');
	});

	test('transforms fragmented URLs reported with the legacy TypeScript format', async () => {
		const load = createLoadSync(createData({ tsconfig: false }));
		const result = load(
			'file:///project/module.ts#fragment',
			{} as never,
			(() => ({ format: 'typescript', source: 'export const answer: number = 42;' })) as never,
		);

		expect(result.format).toBe('module');
		const imported = await importFromSource(result.source as string);
		expect(imported.answer).toBe(42);
	});
});
