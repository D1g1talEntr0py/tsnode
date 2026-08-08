import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	import: vi.fn(async () => ({})),
	registerScoped: vi.fn(() => ({ import: mocks.import, unregister: vi.fn() })),
}));

vi.mock('../src/api/register', () => ({
	register: vi.fn(),
	registerScoped: mocks.registerScoped,
}));

import { tsImport } from '../src/api/index';

test('uses a unique namespace for every scoped import', async () => {
	await Promise.all([
		tsImport('./first.ts', 'file:///project/main.ts'),
		tsImport('./second.ts', 'file:///project/main.ts'),
	]);

	const firstNamespace = mocks.registerScoped.mock.calls[0][0].namespace;
	const secondNamespace = mocks.registerScoped.mock.calls[1][0].namespace;

	expect(firstNamespace).not.toBe(secondNamespace);
});