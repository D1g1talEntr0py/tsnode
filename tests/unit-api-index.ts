import { expect, test, vi } from 'vitest';

import { tsImport } from '../src/api/index';
import * as registration from '../src/api/register';

test('requires a parent URL in the string form', () => {
	// @ts-expect-error Testing the runtime validation for a missing argument.
	expect(() => tsImport('./entry.ts')).toThrow(/current file path/);
});

test('requires parentURL in the options form', () => {
	// @ts-expect-error Testing the runtime validation for an incomplete options object.
	expect(() => tsImport('./entry.ts', {})).toThrow(/current file path/);
});

test('reuses equivalent options and keeps successful scopes registered', async () => {
	const value = { value: 42 };
	const unregister = vi.fn();
	const handle = { import: vi.fn().mockResolvedValue(value), unregister, [Symbol.dispose]: unregister };
	const register = vi.spyOn(registration, 'registerScoped').mockReturnValue(handle);
	const options = { parentURL: import.meta.url, tsconfig: false as const, onImport: () => undefined };
	try {
		const first = await tsImport('./entry.ts', options);
		const second = await tsImport('./entry.ts', { ...options });
		expect(first).toBe(second);
		expect(register).toHaveBeenCalledTimes(1);
		expect(handle.import).toHaveBeenCalledTimes(2);
		expect(handle.unregister).not.toHaveBeenCalled();
	} finally { register.mockRestore(); }
});

test('does not conflate callback identities', async () => {
	const unregister = vi.fn();
	const handle = { import: vi.fn().mockResolvedValue({}), unregister, [Symbol.dispose]: unregister };
	const register = vi.spyOn(registration, 'registerScoped').mockReturnValue(handle);
	const onImport = () => undefined;
	const options = { parentURL: import.meta.url, tsconfig: false as const, onImport };
	try {
		await tsImport('./entry.ts', options);
		await tsImport('./entry.ts', { ...options });
		await tsImport('./entry.ts', { ...options, onImport: () => undefined });
		expect(register).toHaveBeenCalledTimes(2);
	} finally { register.mockRestore(); }
});

test('reuses the same virtual-source map but separates different map identities', async () => {
	const unregister = vi.fn();
	const handle = { import: vi.fn().mockResolvedValue({}), unregister, [Symbol.dispose]: unregister };
	const register = vi.spyOn(registration, 'registerScoped').mockReturnValue(handle);
	const virtualSources = new Map([['virtual://unit/value.js', 'export const value = 42;']]);
	const options = { parentURL: import.meta.url, tsconfig: false as const, virtualSources };
	try {
		await tsImport('virtual://unit/value.js', options);
		await tsImport('virtual://unit/value.js', { ...options });
		await tsImport('virtual://unit/value.js', { ...options, virtualSources: new Map(virtualSources) });
		expect(register).toHaveBeenCalledTimes(2);
		expect(register.mock.calls[0]![0].virtualSources).toBe(virtualSources);
	} finally { register.mockRestore(); }
});

test('only releases a failed new scope after all concurrent imports fail', async () => {
	const first = Promise.withResolvers<object>();
	const second = Promise.withResolvers<object>();
	const unregister = vi.fn();
	const handle = { import: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue({}), unregister, [Symbol.dispose]: unregister };
	const register = vi.spyOn(registration, 'registerScoped').mockReturnValue(handle);
	const options = { parentURL: import.meta.url, tsconfig: false as const, onImport: () => undefined };
	const error = new Error('failed import');
	try {
		const firstImport = tsImport('./first.ts', options);
		const secondImport = tsImport('./second.ts', options);
		const firstRejection = expect(firstImport).rejects.toBe(error);
		first.reject(error);
		await firstRejection;
		expect(handle.unregister).not.toHaveBeenCalled();
		const secondRejection = expect(secondImport).rejects.toBe(error);
		second.reject(error);
		await secondRejection;
		expect(handle.unregister).toHaveBeenCalledTimes(1);
		await tsImport('./retry.ts', options);
		expect(register).toHaveBeenCalledTimes(2);
	} finally { register.mockRestore(); }
});

test('a concurrent success retains the scope after another import fails', async () => {
	const success = Promise.withResolvers<object>();
	const failure = Promise.withResolvers<object>();
	const unregister = vi.fn();
	const handle = { import: vi.fn().mockReturnValueOnce(success.promise).mockReturnValueOnce(failure.promise).mockResolvedValue({}), unregister, [Symbol.dispose]: unregister };
	const register = vi.spyOn(registration, 'registerScoped').mockReturnValue(handle);
	const options = { parentURL: import.meta.url, tsconfig: false as const, onImport: () => undefined };
	try {
		const successfulImport = tsImport('./success.ts', options);
		const failedImport = tsImport('./failure.ts', options);
		const rejected = expect(failedImport).rejects.toThrow('failed');
		failure.reject(new Error('failed'));
		await rejected;
		expect(handle.unregister).not.toHaveBeenCalled();
		success.resolve({});
		await successfulImport;
		await tsImport('./later.ts', options);
		expect(register).toHaveBeenCalledTimes(1);
		expect(handle.unregister).not.toHaveBeenCalled();
	} finally { register.mockRestore(); }
});

test('bounds the reuse lookup without tearing down evicted successful scopes', async () => {
	const handles: { import: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn> }[] = [];
	const register = vi.spyOn(registration, 'registerScoped').mockImplementation(() => {
		const unregister = vi.fn();
		const handle = { import: vi.fn().mockResolvedValue({}), unregister, [Symbol.dispose]: unregister };
		handles.push(handle);
		return handle;
	});
	const firstOptions = { parentURL: import.meta.url, tsconfig: false as const, onImport: () => undefined };
	try {
		await tsImport('./entry.ts', firstOptions);
		const otherOptions = Array.from({ length: 64 }, () => ({ ...firstOptions, onImport: () => undefined }));
		for (let index = 0; index < 64; index += 1) {
			await tsImport('./entry.ts', otherOptions[index]!);
		}
		await tsImport('./entry.ts', firstOptions);
		for (const options of otherOptions) { await tsImport('./entry.ts', options); }
		expect(register).toHaveBeenCalledTimes(65);
		expect(handles.every(handle => handle.unregister.mock.calls.length === 0)).toBe(true);
	} finally { register.mockRestore(); }
});