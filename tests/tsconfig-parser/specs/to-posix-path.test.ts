import { expect, test } from 'vitest';
import { toPosixPath } from '../../../src/utils/tsconfig-parser/utils/to-posix-path';

test('converts backslashes', () => {
	expect(toPosixPath(String.raw`c:\aaaa\bbbb`)).toBe('c:/aaaa/bbbb');
});

test('converts mixed separators', () => {
	expect(toPosixPath(String.raw`c:/aaaa\bbbb`)).toBe('c:/aaaa/bbbb');
});

test('converts paths with non-ASCII characters', () => {
	expect(toPosixPath(String.raw`c:\aaaa\bbbb\★`)).toBe('c:/aaaa/bbbb/★');
});

test('leaves extended-length paths unchanged', () => {
	const extendedLengthPath = String.raw`\\?\c:\aaaa\bbbb`;
	expect(toPosixPath(extendedLengthPath)).toBe(extendedLengthPath);
});

test('leaves POSIX paths unchanged', () => {
	expect(toPosixPath('/aaaa/bbbb')).toBe('/aaaa/bbbb');
});
