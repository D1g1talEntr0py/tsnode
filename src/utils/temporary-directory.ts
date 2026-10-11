import os from 'node:os';
import { join} from 'node:path';
import { chmodSync, lstatSync, mkdirSync, type Stats } from 'node:fs';

type DirectoryStats = Pick<Stats, 'isDirectory' | 'isSymbolicLink' | 'uid'>;

// Cache directory is based on the user's identifier to avoid permission issues when accessed by a different user
const { geteuid } = process;

// For Linux users with virtual users on CI (e.g. Docker). Use username on Windows because it doesn't have id
const userId = geteuid ? geteuid() : os.userInfo().username;

/**
 * Bumped whenever the on-disk cache layout changes. Baking it into the
 * directory name makes an upgrade a clean cut-over: the new version starts
 * empty and the previous directories are swept in the background.
 *
 * v2: cache files are named by key alone (previously `<time>-<key>`), so
 * lookups are a direct read instead of a full-directory index build.
 * v3: exact request identity precedes the transformed payload.
 */
export const cacheSchemaVersion = 3;

const systemTempDirectory = os.tmpdir();

// This ensures that the cache directory is unique per user and has the appropriate permissions
export const tmpdir = join(systemTempDirectory, `tsnode-v${cacheSchemaVersion}-${userId}`);

export const assertPrivateDirectory = (directory: string, stats: DirectoryStats, ownerId: number | undefined) => {
	if (!stats.isDirectory() || stats.isSymbolicLink() || (ownerId !== undefined && stats.uid !== ownerId)) {
		throw new Error(`Unsafe temporary directory: ${directory}`);
	}
};

export const ensurePrivateDirectory = (directory = tmpdir) => {
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const stats = lstatSync(directory);
	assertPrivateDirectory(directory, stats, geteuid?.());

	if (process.platform !== 'win32' && (stats.mode & 0o777) !== 0o700) {
		chmodSync(directory, 0o700);
	}
};

/** Superseded cache directories, removed opportunistically during maintenance. */
export const legacyTempDirs = [
	join(systemTempDirectory, 'tsnode'),
	join(systemTempDirectory, `tsnode-${userId}`),
	join(systemTempDirectory, `tsnode-v2-${userId}`)
];