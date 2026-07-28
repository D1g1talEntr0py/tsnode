import type { Transformed } from './index';
type Cache<T> = {
    get: (key: string) => T | undefined;
    set: (key: string, value: T) => Cache<T>;
    has: (key: string) => boolean;
    clear: () => void;
};
declare class FileCache<T> implements Cache<T> {
    memoryCache: Map<string, T>;
    /**
     * By using tmpdir, the expectation is for the OS to clean any files
     * that haven't been read for a while.
     *
     * macOS - 3 days: https://superuser.com/a/187105
     * Linux - https://serverfault.com/a/377349
     *
     * Note on Windows, temp files are not cleaned up automatically.
     * https://superuser.com/a/1599897
     */
    cacheDirectory: string;
    oldCacheDirectories: string[];
    diskCacheWrites: number;
    /**
     * Entries produced during this process that have not yet been written out.
     * Writes are deferred so the (synchronous) module load hook never blocks on
     * disk I/O; they are flushed on the next event-loop turn, or synchronously
     * on exit if the process ends first.
     */
    pendingWrites: Map<string, T>;
    flushScheduled: boolean;
    exitHookRegistered: boolean;
    cacheDirectoryReady: Promise<void> | undefined;
    cacheDirectoryReadyPath: string | undefined;
    maintenanceScheduled: boolean;
    clear(): void;
    has(key: string): boolean;
    scheduleMaintenance(): void;
    /**
     * Returns true at most once per `minSweepIntervalMs`. The marker is written
     * before sweeping so concurrent processes don't all sweep at once.
     */
    claimSweep(): Promise<boolean>;
    cacheFilePath(key: string): string;
    ensureCacheDirectory(): Promise<void>;
    ensureCacheDirectorySync(): void;
    setMemory(key: string, value: T): void;
    /** Shared by `get`/`getAsync`: memory, then not-yet-flushed writes. */
    getLocal(key: string): NonNullable<T> | undefined;
    acceptDiskHit(key: string, cachedResult: T | undefined): NonNullable<T> | undefined;
    /**
     * Reads and parses one entry.
     *
     * A missing file is an ordinary miss, not corruption. Unlinking on every miss
     * cost a wasted syscall per module on cold runs (~4.4ms for 300 modules in a
     * CPU profile), so only entries that exist but cannot be read are removed.
     */
    readDiskEntry(key: string): T | undefined;
    readDiskEntryAsync(key: string): Promise<T | undefined>;
    get(key: string): NonNullable<T> | undefined;
    getAsync(key: string): Promise<NonNullable<T> | undefined>;
    set(key: string, value: T): this;
    scheduleFlush(): void;
    ensureFlushOnExit(): void;
    /**
     * Drains queued entries.
     *
     * Writes are synchronous by design. The deferral to `setImmediate` is what
     * keeps them out of the (synchronous) load hook; making the writes
     * themselves async only added libuv threadpool dispatch overhead, which
     * measured ~17ms for 100 small files versus ~1.2ms synchronously, and kept
     * the event loop open until it drained.
     */
    flushPendingWrites(): Promise<void>;
    /** Writes and clears the queue. Also used from the exit hook. */
    flushPendingWritesSync(): void;
    /**
     * Sweeps entries untouched for longer than `maxCacheAgeMs`. Entry age comes
     * from the filesystem's mtime rather than a timestamp encoded in the file
     * name, which is what lets lookups be a direct read.
     */
    expireDiskCache(): Promise<void>;
    removeOldCacheDirectories(): Promise<void>;
}
declare const _default: FileCache<Transformed> | Map<string, Transformed>;
export default _default;
