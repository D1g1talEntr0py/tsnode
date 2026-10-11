import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/*.ts', 'tests/tsconfig-parser/**/*.test.ts'],
		fileParallelism: false,
		testTimeout: 300_000,
		hookTimeout: 300_000,
		isolate: false,
		coverage: {
			reportsDirectory: 'tests/coverage',
			include: ['src/**/*.ts'],
			exclude: ['src/types.ts'],
		},
	},
});
