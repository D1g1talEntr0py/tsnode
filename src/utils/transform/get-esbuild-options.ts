import path from 'node:path';
import { Json, type JsonString } from '../json';
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

export const baseConfig = Object.freeze({
	target: `node${process.versions.node}`,
	// "default" tells esbuild to infer loader from file name
	// https://github.com/evanw/esbuild/blob/4a07b17adad23e40cbca7d2f8931e8fb81b47c33/internal/bundler/bundler.go#L158
	loader: 'default'
});

// match Node.js debugger flags
// https://nodejs.org/api/cli.html#--inspecthostport
const NODE_DEBUGGER_FLAG_REGEX = /^--inspect(?:-brk|-port|-publish-uid|-wait)?(?:=|$)/;
const NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX = /^--enable-source-maps(?:=|$)/;
const isNodeDebuggerEnabled = process.execArgv.some(flag => NODE_DEBUGGER_FLAG_REGEX.test(flag));
const isNodeSourceMapsEnabled = process.execArgv.some(flag => NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX.test(flag));
const isV8CoverageEnabled = Boolean(process.env['NODE_V8_COVERAGE']);
const isForcedSourceMapsEnabled = process.env['TSNODE_SOURCE_MAPS'] === '1';
const shouldGenerateSourceMaps = isNodeDebuggerEnabled || isNodeSourceMapsEnabled || isV8CoverageEnabled || isForcedSourceMapsEnabled;

export const cacheConfig = {
	...baseConfig,
	// Source map generation/parsing is expensive and only needed when
	// debugging, collecting coverage, or explicitly requested.
	sourcemap: shouldGenerateSourceMaps,
	/**
	 * Improve performance by only generating sourcesContent
	 * when V8 coverage is enabled or Node.js debugger is enabled
	 *
	 * https://esbuild.github.io/api/#sources-content
	 */
	sourcesContent: isV8CoverageEnabled || isNodeDebuggerEnabled,
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
	minifyWhitespace: true,
	/**
	 * esbuild renames variables even if minification is not enabled
	 * https://esbuild.github.io/try/#dAAwLjE5LjUAAGNvbnN0IGEgPSAxOwooZnVuY3Rpb24gYSgpIHt9KTs
	 */
	keepNames: true
};

const getPathname = (value: string) => {
	const queryIndex = value.indexOf('?');

	return queryIndex === -1 ? value : value.slice(0, queryIndex);
};

export const patchSourcefileOption = (options: TransformOptions) => {
	const originalSourcefile = options.sourcefile;

	if (originalSourcefile && path.extname(getPathname(originalSourcefile)).length === 0) {
		// esbuild errors to detect loader when a file doesn't have an extension
		options.sourcefile += '.js';
	}

	return originalSourcefile;
};

export const patchTransformResult = (result: TransformResult, sourcefile: string | undefined, originalSourcefile: string | undefined): PatchedTransformResult => {
	let sourceMap: SourceMap | undefined;
	if (result.map) {
		if (sourcefile !== originalSourcefile) {
			result.map = result.map.replace(Json.serialize(sourcefile), Json.serialize(originalSourcefile));
		}

		sourceMap = Json.parse(result.map as JsonString<SourceMap>);
	}

	return { code: result.code, map: sourceMap };
};

export const patchOptions = (options: TransformOptions) => {
	const originalSourcefile = patchSourcefileOption(options);

	return (result: TransformResult) => patchTransformResult(result, options.sourcefile, originalSourcefile);
};
