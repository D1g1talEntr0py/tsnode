import { enableCompileCache } from 'node:module';

if (process.env['NODE_DISABLE_COMPILE_CACHE'] !== '1') {
	try { enableCompileCache() } catch { /* ignored */ }
}

(await import('./api/index')).register();

export type {
	ModuleNamespace,
	NamespacedUnregister,
	NodeError,
	Register,
	RegisterHandle,
	RegisterOptions,
	ScopedImport,
	ModuleImport,
	TsImportOptions,
	TsconfigOptions,
	ModuleRequest,
	Unregister
} from './types';