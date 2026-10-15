import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Json } from '../../src/utils/json';

export type FileTree = Record<string, string>;

export const createFixture = async (files: FileTree = {}) => {
	const fixturePath = await mkdtemp(path.join(tmpdir(), 'tsnode-fixture-'));

	try {
		await Promise.all(Object.entries(files).map(async ([fileName, contents]) => {
			const filePath = path.join(fixturePath, fileName);
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, contents);
		}));
	} catch (error) {
		await rm(fixturePath, { recursive: true, force: true });
		throw error;
	}

	const remove = () => rm(fixturePath, { recursive: true, force: true });

	return {
		path: fixturePath,
		getPath: (fileName: string) => path.join(fixturePath, fileName),
		rm: remove,
		[Symbol.asyncDispose]: remove,
	};
};

export const childEnvironment = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
	...process.env,
	FORCE_COLOR: '0',
	...env,
});

const defaultProjectFiles = {
	'package.json': Json.serialize({ type: 'module' })!,
	'tsconfig.json': Json.serialize({ compilerOptions: { target: 'esnext', module: 'esnext' } })!,
};

export const createProjectFixture = (files: FileTree) => createFixture({
	...defaultProjectFiles,
	...files,
});