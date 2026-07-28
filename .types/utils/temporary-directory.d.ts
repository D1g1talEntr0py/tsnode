/**
 * Bumped whenever the on-disk cache layout changes. Baking it into the
 * directory name makes an upgrade a clean cut-over: the new version starts
 * empty and the previous directories are swept in the background.
 *
 * v2: cache files are named by key alone (previously `<time>-<key>`), so
 * lookups are a direct read instead of a full-directory index build.
 */
export declare const cacheSchemaVersion = 2;
/**
 * This ensures that the cache directory is unique per user
 * and has the appropriate permissions
 */
export declare const tmpdir: string;
/** Superseded cache directories, removed opportunistically during maintenance. */
export declare const legacyTmpdirs: string[];
