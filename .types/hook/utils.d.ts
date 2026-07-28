export declare const canTryNativeTypeStripping: (url: string) => boolean;
/**
 * Node refuses to strip types inside node_modules
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so dependencies always go through esbuild
 */
export declare const isNativeFileUrl: (url: string) => boolean;
/**
 * ESM-only: every TypeScript file is treated as a module, so format
 * detection never needs to walk package.json files.
 *
 * Extension is extracted with string scans instead of constructing a URL
 * since this runs for every resolved file path.
 */
export declare const getFormatFromFileUrl: (fileUrl: string) => "module" | undefined;
export declare const namespaceQuery = "tsnode-namespace=";
export declare const getNamespace: (url: string) => string | undefined;
