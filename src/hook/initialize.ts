import { loadTsconfig } from '../utils/tsconfig';
import type { HookData, TypeScriptConfiguration, RegisterOptions } from '../types';

export const ensureParsedTsconfig = (data: HookData): TypeScriptConfiguration | undefined => {
	if (data.tsconfig === false) {
		data.hasLoadedTsconfig = true;
		return undefined;
	}

	if (!data.hasLoadedTsconfig) {
		data.hasLoadedTsconfig = true;
		data.parsedTsconfig = loadTsconfig(data.tsconfig ?? process.env['TSNODE_TSCONFIG_PATH']);
	}

	return data.parsedTsconfig;
};

export const createData = (options?: RegisterOptions): HookData => {
	return {
		active: true,
		hasLoadedTsconfig: false,
		namespace: options?.namespace,
		onImport: options?.onImport,
		parsedTsconfig: undefined,
		virtualSources: options?.virtualSources,
		tsconfig: options?.tsconfig
	};
};
