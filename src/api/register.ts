import module from 'node:module';
import { createData } from '../hook/initialize';
import { createLoadSync } from '../hook/load';
import { createResolveSync } from '../hook/resolve';
import { createScopedImport } from './scoped-import';
import type { RegisterOptions, RequiredProperty, RegisterHandle, NamespacedUnregister } from '../types';

const NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX = /^--enable-source-maps(?:=|$)/;
const NODE_DEBUGGER_FLAG_REGEX = /^--inspect(?:-brk|-port|-publish-uid|-wait)?(?:=|$)/;
const isSourceMapsEnabled = (flag: string) => NODE_ENABLE_SOURCE_MAPS_FLAG_REGEX.test(flag);
const isDebuggerEnabled = (flag: string) => NODE_DEBUGGER_FLAG_REGEX.test(flag);
const shouldEnableSourceMaps = process.execArgv.some(isSourceMapsEnabled) || process.execArgv.some(isDebuggerEnabled) || Boolean(process.env['NODE_V8_COVERAGE']) || process.env['TSNODE_SOURCE_MAPS'] === '1';

export function register(options: RequiredProperty<RegisterOptions, 'namespace'>): NamespacedUnregister;
export function register(options?: RegisterOptions): RegisterHandle;
export function register(options?: RegisterOptions) {
	if (shouldEnableSourceMaps) { process.setSourceMapsEnabled(true) }

	const hookData = createData({ namespace: options?.namespace, onImport: options?.onImport, tsconfig: options?.tsconfig });
	const registeredHooks = module.registerHooks({ load: createLoadSync(hookData), resolve: createResolveSync(hookData) });

	const unregister = async () => {
		hookData.active = false;
		registeredHooks.deregister();

		if (shouldEnableSourceMaps && process.sourceMapsEnabled === false) { process.setSourceMapsEnabled(false) }
	};

	return options?.namespace ? { import: createScopedImport(options.namespace), unregister } : { unregister };
}
