import { type SourceMap } from './get-esbuild-options';
import type { TransformOptions } from 'esbuild';
type CachedTransformOptions = TransformOptions & {
    tsconfigHash?: string;
    getTsconfigRaw?: () => TransformOptions['tsconfigRaw'];
};
export type Transformed = {
    code: string;
    map?: SourceMap;
};
/**
 * Type stripping via Node's built-in stripper. Output is disk-cached so
 * warm runs skip amaro's WASM initialization entirely. Output doesn't
 * depend on the file path (no source map is generated), so the hash
 * doesn't include it, deduplicating identical sources.
 */
export declare const stripTypes: (code: string) => Transformed;
export declare const transformSync: (code: string, filePath: string, extendOptions?: CachedTransformOptions) => Transformed;
export {};
