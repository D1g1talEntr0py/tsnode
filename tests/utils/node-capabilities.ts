import {
	cliTestFlag,
	esmLoadReadFile,
	importAttributes,
	importMetaPathProperties,
	isFeatureSupported,
	modulePackageMainResolution,
	moduleRegister,
	nativeTypeScript,
	testRunnerGlob,
	wasmModules,
	type Version,
} from '../../src/utils/node-features';

export type NodeCapabilities = {
	cli: {
		testFlag: boolean;
		testRunnerGlob: boolean;
	};
	esm: {
		importAttributes: boolean;
		importMetaPathProperties: boolean;
		loadHookCanReadFile: boolean;
	};
	moduleApis: {
		register: boolean;
	};
	moduleResolution: {
		packageMainResolution: boolean;
	};
	typeScript: {
		nativeTypeScript: boolean;
	};
	webAssembly: {
		modules: boolean;
	};
};

export const createNodeCapabilities = (
	current?: Version,
): NodeCapabilities => ({
	cli: {
		testFlag: isFeatureSupported(cliTestFlag, current),
		testRunnerGlob: isFeatureSupported(testRunnerGlob, current),
	},
	esm: {
		importAttributes: isFeatureSupported(importAttributes, current),
		importMetaPathProperties: isFeatureSupported(importMetaPathProperties, current),
		loadHookCanReadFile: isFeatureSupported(esmLoadReadFile, current),
	},
	moduleApis: {
		register: isFeatureSupported(moduleRegister, current),
	},
	moduleResolution: {
		packageMainResolution: isFeatureSupported(modulePackageMainResolution, current),
	},
	typeScript: {
		nativeTypeScript: isFeatureSupported(nativeTypeScript, current),
	},
	webAssembly: {
		modules: isFeatureSupported(wasmModules, current),
	},
});
