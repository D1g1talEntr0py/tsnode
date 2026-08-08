import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	deregister: vi.fn(),
	registerHooks: vi.fn(() => ({ deregister: mocks.deregister })),
	createResolveSync: vi.fn(),
	createLoadSync: vi.fn(),
}));

vi.mock('node:module', async (importOriginal) => ({
	...await importOriginal<typeof import('node:module')>(),
	default: { registerHooks: mocks.registerHooks },
}));

vi.mock('../src/hook/resolve', () => ({
	createResolveSync: mocks.createResolveSync,
}));

vi.mock('../src/hook/load', () => ({
	createLoadSync: mocks.createLoadSync,
}));

beforeEach(() => {
	vi.resetModules();
	mocks.registerHooks.mockClear();
	mocks.deregister.mockClear();
	mocks.createResolveSync.mockReset();
	mocks.createLoadSync.mockReset();

	mocks.createResolveSync.mockImplementation(() => vi.fn((_specifier, _context, nextResolve) => nextResolve(_specifier, {})));
	mocks.createLoadSync.mockImplementation(() => vi.fn((_url, _context, nextLoad) => nextLoad(_url, {})));
});

test('shares one native hook registration across scoped imports', async () => {
	const { registerScoped } = await import('../src/api/register');
	const first = registerScoped({ namespace: 'first', tsconfig: false });
	const second = registerScoped({ namespace: 'second', tsconfig: false });

	expect(mocks.registerHooks).toHaveBeenCalledTimes(1);

	await first.unregister();
	await second.unregister();
});

test('deregisters shared native hooks when the last scoped registration is removed', async () => {
	const { registerScoped } = await import('../src/api/register');
	const first = registerScoped({ namespace: 'first', tsconfig: false });
	const second = registerScoped({ namespace: 'second', tsconfig: false });

	await first.unregister();
	expect(mocks.deregister).not.toHaveBeenCalled();

	await second.unregister();
	expect(mocks.deregister).toHaveBeenCalledTimes(1);
});

test('propagates partial context updates through composed resolve hooks', async () => {
	mocks.createResolveSync.mockImplementation((hookData) => vi.fn((_specifier, context, nextResolve) => {
		if (hookData.namespace === 'first') {
			return nextResolve(_specifier, { ...context, conditions: ['node'] });
		}

		return nextResolve(_specifier, { ...context, parentURL: 'file:///updated.js' });
	}));

	const { registerScoped } = await import('../src/api/register');
	const first = registerScoped({ namespace: 'first', tsconfig: false });
	const second = registerScoped({ namespace: 'second', tsconfig: false });

	const sharedHooks = mocks.registerHooks.mock.calls[0][0];
	const nextResolve = vi.fn();

	sharedHooks.resolve('specifier', { parentURL: 'file:///entry.js', conditions: ['import'] }, nextResolve);

	expect(nextResolve).toHaveBeenCalledWith('specifier', expect.objectContaining({
		parentURL: 'file:///updated.js',
		conditions: ['node'],
	}));

	await first.unregister();
	await second.unregister();
});

test('propagates partial context updates through composed load hooks', async () => {
	mocks.createLoadSync.mockImplementation((hookData) => vi.fn((_url, context, nextLoad) => {
		if (hookData.namespace === 'first') {
			return nextLoad(_url, { ...context, format: 'module' });
		}

		return nextLoad(_url, { ...context, importAttributes: { type: 'json' } });
	}));

	const { registerScoped } = await import('../src/api/register');
	const first = registerScoped({ namespace: 'first', tsconfig: false });
	const second = registerScoped({ namespace: 'second', tsconfig: false });

	const sharedHooks = mocks.registerHooks.mock.calls[0][0];
	const nextLoad = vi.fn();

	sharedHooks.load('file:///entry.ts', { format: 'commonjs', importAttributes: { type: 'js' } }, nextLoad);

	expect(nextLoad).toHaveBeenCalledWith('file:///entry.ts', expect.objectContaining({
		format: 'module',
		importAttributes: { type: 'json' },
	}));

	await first.unregister();
	await second.unregister();
});