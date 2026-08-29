import { expect, test } from 'vitest';

import { tsImport } from '../src/api/index';

test('requires a parent URL in the string form', () => {
	// @ts-expect-error Testing the runtime validation for a missing argument.
	expect(() => tsImport('./entry.ts')).toThrow(/current file path/);
});

test('requires parentURL in the options form', () => {
	// @ts-expect-error Testing the runtime validation for an incomplete options object.
	expect(() => tsImport('./entry.ts', {})).toThrow(/current file path/);
});