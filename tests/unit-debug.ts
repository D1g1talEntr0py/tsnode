import { expect, test } from 'vitest';
import { formatDebugValue } from '../src/utils/debug';

test('formats Error instances with their message and stack', () => {
	const error = new Error('boom');
	const formatted = formatDebugValue(error);

	expect(formatted).toContain('Error');
	expect(formatted).toContain('boom');
	expect(formatted).toContain('stack');
});

test('formats bigint and circular values safely', () => {
	const circular: Record<string, unknown> = { a: 1 };
	circular.self = circular;

	expect(formatDebugValue(42n)).toBe('"42n"');
	expect(formatDebugValue(circular)).toContain('[Circular]');
});
