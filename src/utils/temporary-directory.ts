import path from 'node:path';
import os from 'node:os';

/**
 * Cache directory is based on the user's identifier
 * to avoid permission issues when accessed by a different user
 */
const { geteuid } = process;

// For Linux users with virtual users on CI (e.g. Docker)
// Use username on Windows because it doesn't have id
const userId = (geteuid ? geteuid() : os.userInfo().username);

/**
 * Bumped whenever the on-disk cache layout changes. Baking it into the
 * directory name makes an upgrade a clean cut-over: the new version starts
 * empty and the previous directories are swept in the background.
 *
 * v2: cache files are named by key alone (previously `<time>-<key>`), so
 * lookups are a direct read instead of a full-directory index build.
 */
export const cacheSchemaVersion = 2;

/**
 * This ensures that the cache directory is unique per user
 * and has the appropriate permissions
 */
export const tmpdir = path.join(os.tmpdir(), `tsnode-v${cacheSchemaVersion}-${userId}`);

/** Superseded cache directories, removed opportunistically during maintenance. */
export const legacyTmpdirs = [
	path.join(os.tmpdir(), 'tsnode'),
	path.join(os.tmpdir(), `tsnode-${userId}`),
];