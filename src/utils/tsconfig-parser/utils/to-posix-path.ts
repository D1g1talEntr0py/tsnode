// Mirrors slash@5: extended-length paths (`\\?\`) are returned unchanged.
export const toPosixPath = (path: string) => (path.startsWith('\\\\?\\') ? path : path.replaceAll('\\', '/'));
