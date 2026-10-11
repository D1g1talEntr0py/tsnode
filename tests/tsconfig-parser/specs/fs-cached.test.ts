import { writeFile } from 'node:fs/promises';
import { expect, describe, test } from 'vitest';
import { createFixture } from '../utils/fixture';
import { stat, exists, realpath } from '../../../src/utils/tsconfig-parser/utils/fs-cached';

describe('fs-cached', () => {
	test('stat caches missing paths as undefined', async () => {
		await using fixture = await createFixture({});
		const filePath = fixture.getPath('missing.json');
		const cache = new Map<string, unknown>();

		expect(stat(cache, filePath)).toBe(undefined);
		expect(cache.has(`statSync:${filePath}`)).toBe(true);
		expect(cache.get(`statSync:${filePath}`)).toBe(undefined);

		await writeFile(filePath, '{}');

		expect(stat(cache, filePath)).toBe(undefined);
		expect(exists(cache, filePath)).toBe(false);
		expect(cache.size).toBe(1);
	});

	test('stat caches existing Stats', async () => {
		await using fixture = await createFixture({ 'file.json': '{}' });
		const filePath = fixture.getPath('file.json');
		const cache = new Map<string, unknown>();

		const stats = stat(cache, filePath);
		expect(stats?.isFile()).toBe(true);
		expect(cache.get(`statSync:${filePath}`)).toBe(stats);
		expect(stat(cache, filePath)).toBe(stats);
		expect(exists(cache, filePath)).toBe(true);
		expect(cache.size).toBe(1);
	});

	test('stat does not throw for invalid paths', () => {
		expect(stat(undefined, 'invalid\0path')).toBe(undefined);
	});

	test('realpath throws TypeError for non-string cached values', () => {
		const cache = new Map<string, unknown>([['realpathSync:/some/path', 1]]);

		expect(() => realpath(cache, '/some/path')).toThrow(TypeError);
	});
});
