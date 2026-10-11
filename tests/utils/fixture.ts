import { createFixture } from 'fs-fixture';

export const childEnvironment = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
	...process.env,
	FORCE_COLOR: '0',
	...env,
});

const defaultProjectFiles = {
	'package.json': JSON.stringify({ type: 'module' }),
	'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext' } }),
};

export const createProjectFixture = (files: Record<string, string>) => createFixture({
	...defaultProjectFiles,
	...files,
});