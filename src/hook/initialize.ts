import { loadTsconfig } from '../utils/tsconfig';
import type { RegisterOptions, TsconfigOptions } from '../types';

type Data = {
	active: boolean;
	hasLoadedTsconfig: boolean;
	namespace?: string;
	onImport?: (url: string) => void;
	virtualSources?: Map<string, string>;
	parsedTsconfig: ReturnType<typeof loadTsconfig>;
	tsconfig?: TsconfigOptions;
};

export type { Data };

export const ensureParsedTsconfig = (data: Data) => {
	if (data.tsconfig === false) {
		data.hasLoadedTsconfig = true;
		return undefined;
	}

	if (!data.hasLoadedTsconfig) {
		data.parsedTsconfig = loadTsconfig(data.tsconfig ?? process.env?.['TSNODE_TSCONFIG_PATH']);
		data.hasLoadedTsconfig = true;
	}

	return data.parsedTsconfig;
};

export const createData = (options?: RegisterOptions): Data => {
	return {
		active: true,
		hasLoadedTsconfig: false,
		namespace: options?.namespace,
		onImport: options?.onImport,
		parsedTsconfig: undefined,
		virtualSources: (options as RegisterOptions & { virtualSources?: Map<string, string> } | undefined)?.virtualSources,
		tsconfig: options?.tsconfig
	};
};
