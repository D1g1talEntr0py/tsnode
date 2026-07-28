import type { TransformOptions, TransformResult } from 'esbuild';
/** Parsed esbuild source map (JSON of TransformResult['map']) */
export type SourceMap = {
    version: number;
    sources: string[];
    names: string[];
    mappings: string;
    sourcesContent?: string[];
    sourceRoot?: string;
    file?: string;
};
export type PatchedTransformResult = {
    code: string;
    map?: SourceMap;
};
export declare const baseConfig: Readonly<{
    target: `node${string}`;
    loader: "default";
}>;
export declare const cacheConfig: {
    target: `node${string}`;
    loader: "default";
    sourcemap: boolean;
    /**
     * Improve performance by only generating sourcesContent
     * when V8 coverage is enabled or Node.js debugger is enabled
     *
     * https://esbuild.github.io/api/#sources-content
     */
    sourcesContent: boolean;
    /**
     * Smaller output for cache and marginal performance improvement:
     * https://twitter.com/evanwallace/status/1396336348366180359?s=20
     *
     * minifyIdentifiers is disabled because debuggers don't use the
     * `names` property from the source map
     *
     * minifySyntax is disabled because it does some tree-shaking
     * eg. unused try-catch error variable
     */
    minifyWhitespace: boolean;
    /**
     * esbuild renames variables even if minification is not enabled
     * https://esbuild.github.io/try/#dAAwLjE5LjUAAGNvbnN0IGEgPSAxOwooZnVuY3Rpb24gYSgpIHt9KTs
     */
    keepNames: boolean;
};
export declare const patchSourcefileOption: (options: TransformOptions) => string | undefined;
export declare const patchTransformResult: (result: TransformResult, sourcefile: string | undefined, originalSourcefile: string | undefined) => PatchedTransformResult;
export declare const patchOptions: (options: TransformOptions) => (result: TransformResult) => PatchedTransformResult;
