import module from 'node:module';
import { expect, test, vi } from 'vitest';
import { register, registerScoped } from '../src/api/register';
import * as resolver from '../src/hook/resolve';
import * as loader from '../src/hook/load';
import type { NamespacedUnregister } from '../src/types';

test('register returns an unscoped handle when no namespace is provided', () => {
	const handle = register({ tsconfig: false });

	try {
		expect(handle).toEqual({ unregister: expect.any(Function), [Symbol.dispose]: handle.unregister });
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

test('empty namespaces are rejected for both registration paths', () => {
	expect(() => register({ namespace: '', tsconfig: false })).toThrow(/namespace must not be empty/);
	expect(() => registerScoped({ namespace: '', tsconfig: false })).toThrow(/namespace must not be empty/);
});

test.each(['register', 'registerScoped'] as const)('%s unregister is idempotent', (registration) => {
	const deregister = vi.fn();
	const nativeRegistration = vi.spyOn(module, 'registerHooks').mockReturnValue({ deregister } as ReturnType<typeof module.registerHooks>);
	try {
		const handle = registration === 'register' ? register({ tsconfig: false }) : registerScoped({ namespace: 'unregister', tsconfig: false });
		handle.unregister();
		handle[Symbol.dispose]();
		expect(deregister).toHaveBeenCalledTimes(1);
	} finally {
		nativeRegistration.mockRestore();
	}
});

test.each(['register', 'registerScoped'] as const)('%s supports using scope exit and exception cleanup without native disposal', (registration) => {
	const deregister = vi.fn();
	const nativeRegistration = vi.spyOn(module, 'registerHooks').mockReturnValue({ deregister } as ReturnType<typeof module.registerHooks>);
	const createRegistration = () => registration === 'register' ? register({ tsconfig: false }) : registerScoped({ namespace: 'using', tsconfig: false });
	try {
		{
			using handle = createRegistration();
			expect(handle[Symbol.dispose]).toBe(handle.unregister);
			expect(deregister).not.toHaveBeenCalled();
		}
		expect(deregister).toHaveBeenCalledTimes(1);
		expect(() => {
			using handle = createRegistration();
			expect(handle[Symbol.dispose]).toBe(handle.unregister);
			throw new Error('using failure');
		}).toThrow('using failure');
		expect(deregister).toHaveBeenCalledTimes(2);
	} finally {
		nativeRegistration.mockRestore();
	}
});

test('dispatches directly among 100 scopes and preserves partial downstream contexts', () => {
	const deregister = vi.fn();
	const nativeRegistration = vi.spyOn(module, 'registerHooks').mockReturnValue({ deregister } as ReturnType<typeof module.registerHooks>);
	const resolvedScopes: (string | undefined)[] = [];
	const loadedScopes: (string | undefined)[] = [];
	const resolveFactory = vi.spyOn(resolver, 'createResolveSync').mockImplementation(data => (specifier, context, nextResolve) => {
		resolvedScopes.push(data.namespace);
		expect(context.conditions).toEqual(['node', 'custom']);
		return nextResolve(specifier, { parentURL: 'file:///updated.ts' });
	});
	const loadFactory = vi.spyOn(loader, 'createLoadSync').mockImplementation(data => (url, context, nextLoad) => {
		loadedScopes.push(data.namespace);
		expect(context.importAttributes).toEqual({ custom: 'attribute' });
		return nextLoad(url, { format: 'module' });
	});
	const handles: NamespacedUnregister[] = [];
	try {
		for (let index = 0; index < 100; index += 1) {
			handles.push(registerScoped({ namespace: `scope-${index}`, tsconfig: false }));
		}
		expect(nativeRegistration).toHaveBeenCalledTimes(1);
		const hooks = nativeRegistration.mock.calls[0]![0];
		const context = { conditions: ['node', 'custom'], importAttributes: { custom: 'attribute' }, parentURL: 'file:///parent.ts' };
		const nextResolve = vi.fn().mockReturnValue({ url: 'file:///entry.ts', format: 'module', shortCircuit: true });
		hooks.resolve!(`tsnode://${JSON.stringify({ namespace: 'scope-99', specifier: './entry.ts', parentURL: context.parentURL })}`, context, nextResolve);
		expect(resolvedScopes).toEqual(['scope-99']);
		expect(nextResolve.mock.calls[0]![1]).toEqual({ ...context, parentURL: 'file:///updated.ts' });
		hooks.resolve!('./child.ts', { ...context, parentURL: 'file:///parent.ts?tsnode-namespace=scope-0' }, nextResolve);
		expect(resolvedScopes).toEqual(['scope-99', 'scope-0']);
		hooks.resolve!('./unscoped.ts', context, nextResolve);
		expect(resolvedScopes).toHaveLength(2);
		const nextLoad = vi.fn().mockReturnValue({ format: 'module', source: '' });
		hooks.load!('file:///entry.ts?tsnode-namespace=scope-99', { ...context, format: undefined }, nextLoad);
		expect(loadedScopes).toEqual(['scope-99']);
		expect(nextLoad.mock.calls[0]![1]).toEqual({ ...context, format: 'module' });
	} finally {
		for (const handle of handles) { handle.unregister(); }
		resolveFactory.mockRestore();
		loadFactory.mockRestore();
		nativeRegistration.mockRestore();
	}
	expect(deregister).toHaveBeenCalledTimes(1);
});

test('public registrations keep independent native hook ownership', () => {
	const deregistrations: ReturnType<typeof vi.fn>[] = [];
	const nativeRegistration = vi.spyOn(module, 'registerHooks').mockImplementation(() => {
		const deregister = vi.fn();
		deregistrations.push(deregister);
		return { deregister } as ReturnType<typeof module.registerHooks>;
	});
	const handles: { unregister: () => void }[] = [];
	try {
		handles.push(register({ namespace: 'public-first', tsconfig: false }));
		handles.push(register({ namespace: 'public-second', tsconfig: false }));
		handles.push(registerScoped({ namespace: 'internal', tsconfig: false }));
		expect(nativeRegistration).toHaveBeenCalledTimes(3);
		handles[0]!.unregister();
		expect(deregistrations[0]).toHaveBeenCalledTimes(1);
		expect(deregistrations[1]).not.toHaveBeenCalled();
		expect(deregistrations[2]).not.toHaveBeenCalled();
	} finally {
		for (const handle of handles.slice(1)) { handle.unregister(); }
		nativeRegistration.mockRestore();
	}
});