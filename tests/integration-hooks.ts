import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createProjectFixture } from './utils/fixture';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceResolveHookPath = path.join(import.meta.dirname, 'utils/source-resolve-hook.ts');

describe('native hook integration', () => {
	test('registers real hooks that import a TypeScript fixture', async () => {
		await using fixture = await createProjectFixture({
			'entry.ts': 'export const answer: number = 42;\n',
		});

		const entryPath = fileURLToPath(new URL('entry.ts', pathToFileURL(`${fixture.path}/`).href));
		const entryUrl = pathToFileURL(entryPath).href;
		const registerPath = pathToFileURL(`${projectRoot}/src/api/register.ts`).href;
		const script = `import { register } from ${JSON.stringify(registerPath)};\nconst handle = register({ namespace: 'probe', tsconfig: false });\ntry { console.log(JSON.stringify(await handle.import(${JSON.stringify(entryUrl)}, ${JSON.stringify(entryUrl)}))); } finally { handle.unregister(); }`;
		const { stdout } = await execFileAsync(process.execPath, [
			'--experimental-strip-types',
			'--import', sourceResolveHookPath,
			'--input-type=module',
			'--eval', script,
		], { cwd: fixture.path });

		expect(JSON.parse(stdout)).toMatchObject({ answer: 42 });
	});
});