import path from 'node:path';
import { tmpdir } from '../temporary-directory';

export const isWindows = process.platform === 'win32';

export const getPipePath = (processId: number) => {
	const pipePath = path.join(tmpdir, `${processId}.pipe`);
	return isWindows ? `\\\\?\\pipe\\${pipePath}` : pipePath;
};