import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';

type Link = {
	target: string;
	type?: 'dir' | 'file';
};

type FixtureContext = {
	fixturePath: string;
	getPath: (filePath: string) => string;
	symlink: (target: string, type?: Link['type']) => Link;
};

type FixtureEntry = string | FixtureTree | ((context: FixtureContext) => string | Link);
type FixtureTree = { [filePath: string]: FixtureEntry };

export const createFixture = async (tree: FixtureTree) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'get-tsconfig-'));
	const getPath = (filePath: string) => path.resolve(root, filePath);
	const remove = async (filePath?: string) => {
		const target = filePath === undefined ? root : getPath(filePath);
		if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
			throw new Error(`Cannot remove path outside fixture: ${target}`);
		}
		await rm(target, { recursive: true, force: true });
	};
	const links: { filePath: string; link: Link }[] = [];
	const writeTree = async (directory: string, entries: FixtureTree) => {
		for (const [name, entry] of Object.entries(entries)) {
			const filePath = path.resolve(directory, name);
			if (!filePath.startsWith(`${root}${path.sep}`)) {
				throw new Error(`Cannot write path outside fixture: ${filePath}`);
			}
			await mkdir(path.dirname(filePath), { recursive: true });
			if (typeof entry === 'function') {
				const value = entry({ fixturePath: root, getPath, symlink: (target, type) => type === undefined ? { target } : { target, type } });
				if (typeof value === 'string') {
					await writeFile(filePath, value);
				} else {
					links.push({ filePath, link: value });
				}
			} else if (typeof entry === 'string') {
				await writeFile(filePath, entry);
			} else {
				await mkdir(filePath, { recursive: true });
				await writeTree(filePath, entry);
			}
		}
	};
	try {
		await writeTree(root, tree);
		for (const { filePath, link } of links) {
			const target = path.resolve(path.dirname(filePath), link.target);
			const type = link.type ?? ((await stat(target)).isDirectory() ? 'dir' : 'file');
			await symlink(
				process.platform === 'win32' && type === 'dir' ? target : link.target,
				filePath,
				process.platform === 'win32' && type === 'dir' ? 'junction' : type
			);
		}
	} catch (error) {
		await remove();
		throw error;
	}
	return { path: `${root}${path.sep}`, getPath, rm: remove, [Symbol.asyncDispose]: () => remove() };
};
