/**
 * Relative `paths` substitutions resolve against the tsconfig that declared `paths` when
 * `baseUrl` is not used (always in TypeScript 7, only without `baseUrl` in TypeScript 6).
 *
 * However, this is impossible to compute from a flattened tsconfig, because we no longer know
 * the path of the tsconfig that defined the `paths` entry.
 *
 * This is why we store the declaring directory in the flattened tsconfig, so that the pathsMatcher
 * can use it to resolve relative paths.
 */
export const implicitBaseUrlSymbol = Symbol('implicitBaseUrl');

export const configDirPlaceholder = '${configDir}';
