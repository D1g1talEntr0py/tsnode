import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/*.ts'],
		fileParallelism: false,
		testTimeout: 300_000,
		hookTimeout: 300_000,
		coverage: {
			reportsDirectory: 'tests/coverage',
		},
	},
});
