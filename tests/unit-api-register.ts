import { expect, test } from 'vitest';
import { register, registerScoped } from '../src/api/register';

test('register returns an unscoped handle when no namespace is provided', () => {
	const handle = register({ tsconfig: false });

	try {
		expect(handle).toEqual({ unregister: expect.any(Function) });
		expect('import' in handle).toBe(false);
	} finally {
		handle.unregister();
	}
});

test('registerScoped returns an import handle for its namespace', () => {
	const handle = registerScoped({ namespace: 'unit-api-register', tsconfig: false });

	try {
		expect(handle.import).toEqual(expect.any(Function));
		expect(handle.unregister).toEqual(expect.any(Function));
	} finally {
		handle.unregister();
	}
});