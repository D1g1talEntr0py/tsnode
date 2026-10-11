import module from 'node:module';
import { createData } from '../hook/initialize';
import { createLoadSync } from '../hook/load';
import { createResolveSync } from '../hook/resolve';
import { getNamespace, getModuleRequest } from '../hook/utils.js';
import { createScopedImport } from './scoped-import';
import type { RegisterOptions, RequiredProperty, RegisterHandle, NamespacedUnregister } from '../types';
import type { LoadHookContext, LoadHookSync, ResolveHookContext, ResolveHookSync } from 'node:module';

type ScopedHooks = {
	load: LoadHookSync;
	resolve: ResolveHookSync;
	releaseSourceMaps: () => void;
};

type SourceMapsLease = {
	previous: ReturnType<typeof module.getSourceMapsSupport>;
	owned: ReturnType<typeof module.getSourceMapsSupport>;
	owners: number;
};

let sourceMapsLease: SourceMapsLease | undefined;
const NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX = /^--enable-source-maps(?:=|$)/;
const NODE_DEBUGGER_FLAG_REGEX = /^--inspect(?:-brk|-port|-publish-uid|-wait)?(?:=|$)/;
const isSourceMapsEnabled = (flag: string) => NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX.test(flag);
const isDebuggerEnabled = (flag: string) => NODE_DEBUGGER_FLAG_REGEX.test(flag);
const shouldEnableSourceMaps = process.execArgv.some(isSourceMapsEnabled) || process.execArgv.some(isDebuggerEnabled) || Boolean(process.env['NODE_V8_COVERAGE']) || process.env['TSNODE_SOURCE_MAPS'] === '1';

const acquireSourceMaps = () => {
	let lease: SourceMapsLease | undefined;

	if (shouldEnableSourceMaps) {
		const current = module.getSourceMapsSupport();

		if (sourceMapsLease?.owned !== current) { sourceMapsLease = undefined }

		if (!sourceMapsLease && !current.enabled) {
			module.setSourceMapsSupport(true, { nodeModules: true, generatedCode: true });
			sourceMapsLease = { previous: current, owned: module.getSourceMapsSupport(), owners: 0 };
		}

		lease = sourceMapsLease;
		if (lease) { lease.owners += 1 }
	}

	return () => {
		if (!lease) { return }

		const released = lease;
		lease = undefined;
		released.owners -= 1;

		if (released.owners !== 0) { return }

		if (sourceMapsLease === released) { sourceMapsLease = undefined }

		if (module.getSourceMapsSupport() === released.owned) {
			module.setSourceMapsSupport(released.previous.enabled, released.previous);
		}
	};
};

const scopedHooks = new Map<string, ScopedHooks>();
let sharedHooksRegistered = false;
let sharedNativeHooks: { deregister: () => void } | undefined;

const mergeResolveContext = (context: ResolveHookContext, update?: Partial<ResolveHookContext>): ResolveHookContext => ({
	...context,
	...update,
	conditions: update?.conditions ?? context.conditions,
	importAttributes: update?.importAttributes ?? context.importAttributes
});

const mergeLoadContext = (context: LoadHookContext, update?: Partial<LoadHookContext>): LoadHookContext => ({
	...context,
	...update,
	conditions: update?.conditions ?? context.conditions,
	format: update?.format ?? context.format,
	importAttributes: update?.importAttributes ?? context.importAttributes
});

const sharedResolve: ResolveHookSync = (specifier, context, nextResolve) => {
	const namespace = getModuleRequest(specifier)?.namespace ?? getNamespace(specifier) ?? (context.parentURL ? getNamespace(context.parentURL) : undefined);
	const hooks = namespace === undefined ? undefined : scopedHooks.get(namespace);

	return hooks ? hooks.resolve(specifier, context, (nextSpecifier, nextContext) => nextResolve(nextSpecifier, mergeResolveContext(context, nextContext))) : nextResolve(specifier, context);
};

const sharedLoad: LoadHookSync = (url, context, nextLoad) => {
	const namespace = getNamespace(url);
	const hooks = namespace === undefined ? undefined : scopedHooks.get(namespace);

	return hooks ? hooks.load(url, context, (nextUrl, nextContext) => nextLoad(nextUrl, mergeLoadContext(context, nextContext))) : nextLoad(url, context);
};

const validateNamespace = (namespace: string | undefined) => {
	if (namespace === '') { throw new TypeError('The namespace must not be empty') }
};

const withVirtualSources = (options: RegisterOptions | undefined, resolve: ResolveHookSync): ResolveHookSync => {
	if (!options?.namespace || !options.virtualSources) { return resolve }

	const { namespace, virtualSources } = options;

	return (specifier, context, nextResolve) => {
		const request = getModuleRequest(specifier);
		if (request?.namespace ?? getNamespace(specifier) ?? (context.parentURL ? getNamespace(context.parentURL) : undefined) === namespace) {
			let sourceUrl = request?.specifier ?? specifier;

			if (sourceUrl.startsWith('./') || sourceUrl.startsWith('../')) {
				sourceUrl = new URL(sourceUrl, request?.parentURL ?? context.parentURL).href;
			}

			const parsed = new URL(sourceUrl, request?.parentURL ?? context.parentURL);
			parsed.searchParams.delete('tsnode-namespace');

			if (virtualSources.has(sourceUrl) || virtualSources.has(parsed.href)) {
				parsed.searchParams.set('tsnode-namespace', namespace);

				return { format: 'module', shortCircuit: true, url: parsed.href };
			}
		}

		return resolve(specifier, context, nextResolve);
	};
};

/**
 * Registers scoped loader hooks for the current process.
 * @param options The options for registering the scoped hooks.
 * @returns An object with an `import()` method for scoped imports and an `unregister()` method to remove the hooks.
 */
export const registerScoped = (options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister => {
	validateNamespace(options.namespace);

	const hookData = createData(options);
	const releaseSourceMaps = acquireSourceMaps();
	const hooks = { load: createLoadSync(hookData), resolve: withVirtualSources(options, createResolveSync(hookData)), releaseSourceMaps };

	try {
		if (!sharedHooksRegistered) {
			sharedNativeHooks = module.registerHooks({ load: sharedLoad, resolve: sharedResolve });
			sharedHooksRegistered = true;
		}
	} catch (error) {
		releaseSourceMaps();
		throw error;
	}

	scopedHooks.get(options.namespace)?.releaseSourceMaps();
	scopedHooks.set(options.namespace, hooks);

	const unregister = () => {
		if (!hookData.active) { return }

		hookData.active = false;
		releaseSourceMaps();

		if (scopedHooks.get(options.namespace) !== hooks) { return }

		scopedHooks.delete(options.namespace);

		if (scopedHooks.size === 0 && sharedNativeHooks) {
			sharedNativeHooks.deregister();
			sharedNativeHooks = undefined;
			sharedHooksRegistered = false;
		}
	};

	return { import: createScopedImport(options.namespace), unregister, [Symbol.dispose]: unregister };
};

/**
 * Registers the tsnode loader hooks for the current process. Returns an object with an `unregister()` method to remove the hooks.
 * @param options Optional configuration for the loader hooks.
 * @returns An object with an `unregister()` method to remove the hooks, and if a namespace is provided, an `import()` method for scoped imports.
 */
export function register(options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister;
/**
 * Registers the tsnode loader hooks for the current process. Returns an object with an `unregister()` method to remove the hooks.
 * @param options Optional configuration for the loader hooks.
 * @returns An object with an `unregister()` method to remove the hooks.
 */
export function register(options?: RegisterOptions): RegisterHandle;
/**
 * Registers the tsnode loader hooks for the current process. Returns an object with an `unregister()` method to remove the hooks.
 * @param options Optional configuration for the loader hooks.
 * @returns An object with an `unregister()` method to remove the hooks, and if a namespace is provided, an `import()` method for scoped imports.
 */
export function register(options?: RegisterOptions) {
	validateNamespace(options?.namespace);

	const hookData = createData(options);
	const releaseSourceMaps = acquireSourceMaps();
	let registeredHooks: ReturnType<typeof module.registerHooks>;

	try {
		registeredHooks = module.registerHooks({ load: createLoadSync(hookData), resolve: withVirtualSources(options, createResolveSync(hookData)) });
	} catch (error) {
		releaseSourceMaps();
		throw error;
	}

	const unregister = () => {
		if (!hookData.active) { return }

		hookData.active = false;
		try { registeredHooks.deregister() } finally { releaseSourceMaps() }
	};

	return options?.namespace ? { import: createScopedImport(options.namespace), unregister, [Symbol.dispose]: unregister } : { unregister, [Symbol.dispose]: unregister };
}
