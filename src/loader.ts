import { enableCompileCache } from 'node:module';

if (process.env['NODE_DISABLE_COMPILE_CACHE'] !== '1') {
	try { enableCompileCache() } catch {}
}

await import('./suppress-warnings');
(await import('./api/index')).register();

export type {
	NamespacedUnregister,
	NodeError,
	Register,
	RegisterHandle,
	RegisterOptions,
	ScopedImport,
	TsconfigOptions,
	TsnodeRequest,
	Unregister,
} from './types';