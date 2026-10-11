// Only works on POSIX paths. Apply `toPosixPath` first.
export const isRelativePathPattern = /^\.{1,2}(\/.*)?$/;
