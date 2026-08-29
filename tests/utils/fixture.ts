import { createFixture } from 'fs-fixture';

const defaultProjectFiles = {
	'package.json': JSON.stringify({ type: 'module' }),
	'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext' } }),
};

export const createProjectFixture = (files: Record<string, string>) => createFixture({
	...defaultProjectFiles,
	...files,
});