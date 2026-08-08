import module from 'node:module';
import { createData } from '../hook/initialize';
import { createLoadSync } from '../hook/load';
import { createResolveSync } from '../hook/resolve';
import { createScopedImport } from './scoped-import';
import type { RegisterOptions, RequiredProperty, RegisterHandle, NamespacedUnregister } from '../types';
import type { LoadHookContext, LoadHookSync, ResolveHookContext, ResolveHookSync } from 'node:module';

const NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX = /^--enable-source-maps(?:=|$)/;
const NODE_DEBUGGER_FLAG_REGEX = /^--inspect(?:-brk|-port|-publish-uid|-wait)?(?:=|$)/;
const isSourceMapsEnabled = (flag: string) => NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX.test(flag);
const isDebuggerEnabled = (flag: string) => NODE_DEBUGGER_FLAG_REGEX.test(flag);
const shouldEnableSourceMaps = process.execArgv.some(isSourceMapsEnabled) || process.execArgv.some(isDebuggerEnabled) || Boolean(process.env['NODE_V8_COVERAGE']) || process.env['TSNODE_SOURCE_MAPS'] === '1';

type ScopedHooks = {
	load: LoadHookSync;
	resolve: ResolveHookSync;
};

const scopedHooks = new Map<string, ScopedHooks>();
let sharedHooksRegistered = false;
let sharedNativeHooks: { deregister: () => void } | undefined;

const mergeResolveContext = (context: ResolveHookContext, update?: Partial<ResolveHookContext>): ResolveHookContext => ({
	...context,
	...update,
	conditions: update?.conditions ?? context.conditions,
	importAttributes: update?.importAttributes ?? context.importAttributes,
});

const mergeLoadContext = (context: LoadHookContext, update?: Partial<LoadHookContext>): LoadHookContext => ({
	...context,
	...update,
	conditions: update?.conditions ?? context.conditions,
	format: update?.format ?? context.format,
	importAttributes: update?.importAttributes ?? context.importAttributes,
});

const sharedResolve: ResolveHookSync = (specifier, context, nextResolve) => {
	let resolve = nextResolve;
	let currentContext = context;
	for (const hooks of scopedHooks.values()) {
		const next = resolve;
		resolve = (nextSpecifier, nextContext) => {
			currentContext = mergeResolveContext(currentContext, nextContext);
			return hooks.resolve(nextSpecifier, currentContext, next);
		};
	}

	return resolve(specifier, context);
};

const sharedLoad: LoadHookSync = (url, context, nextLoad) => {
	let load = nextLoad;
	let currentContext = context;
	for (const hooks of scopedHooks.values()) {
		const next = load;
		load = (nextUrl, nextContext) => {
			currentContext = mergeLoadContext(currentContext, nextContext);
			return hooks.load(nextUrl, currentContext, next);
		};
	}

	return load(url, context);
};

export const registerScoped = (options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister => {
	if (shouldEnableSourceMaps) { process.setSourceMapsEnabled(true) }

	if (!sharedHooksRegistered) {
		sharedNativeHooks = module.registerHooks({ load: sharedLoad, resolve: sharedResolve });
		sharedHooksRegistered = true;
	}

	const hookData = createData(options);
	scopedHooks.set(options.namespace, { load: createLoadSync(hookData), resolve: createResolveSync(hookData) });

	return {
		import: createScopedImport(options.namespace),
		unregister: async () => {
			hookData.active = false;
			scopedHooks.delete(options.namespace);

			if (scopedHooks.size === 0 && sharedNativeHooks) {
				sharedNativeHooks.deregister();
				sharedNativeHooks = undefined;
				sharedHooksRegistered = false;
			}
		},
	};
};

export function register(options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister;
export function register(options?: RegisterOptions): RegisterHandle;
export function register(options?: RegisterOptions) {
	if (shouldEnableSourceMaps) { process.setSourceMapsEnabled(true) }

	const hookData = createData(options);
	const registeredHooks = module.registerHooks({ load: createLoadSync(hookData), resolve: createResolveSync(hookData) });

	const unregister = async () => {
		hookData.active = false;
		registeredHooks.deregister();

		if (shouldEnableSourceMaps && process.sourceMapsEnabled === false) { process.setSourceMapsEnabled(false) }
	};

	return options?.namespace ? { import: createScopedImport(options.namespace), unregister } : { unregister };
}
