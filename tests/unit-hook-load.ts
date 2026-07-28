import { describe, expect, test } from 'vitest';
import { createData } from '../src/hook/initialize';
import { createLoadSync } from '../src/hook/load';

const importFromSource = async (source: string) => {
	const encoded = Buffer.from(source, 'utf8').toString('base64');
	return import(`data:text/javascript;base64,${encoded}`);
};

describe('hook load', () => {
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
});
