import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { createFixture } from './utils/fixture';

describe('filesystem fixtures', () => {
	test('writes real nested files and removes the fixture on disposal', async () => {
		let fixturePath = '';
		{
			await using fixture = await createFixture({ 'nested/entry.ts': 'export const value = 42;' });
			fixturePath = fixture.path;
			expect(await readFile(fixture.getPath('nested/entry.ts'), 'utf8')).toBe('export const value = 42;');
		}
		expect(existsSync(fixturePath)).toBe(false);
	});
});