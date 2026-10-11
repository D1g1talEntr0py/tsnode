import type { FlagDefinition, Flags } from './types';
export type { FlagDefinition, Flags } from './types';

const toCamelCase = (value: string) => value.replace(/-([a-z])/g, (_, character: string) => character.toUpperCase());

const getFlagEntry = (flags: Flags, name: string) => {
	const definition = flags[name];
	if (definition) { return [ name, definition ] as const }

	const camelName = toCamelCase(name);
	const camelDefinition = flags[camelName];

	return camelDefinition ? [ camelName, camelDefinition ] as const : undefined;
};

const getFlagByAlias = (flags: Flags, alias: string) => {
	for (const name in flags) {
		const definition = flags[name];
		if (definition?.alias === alias) { return [ name, definition ] as const }
	}

	return undefined;
};

const splitInlineFlag = (argument: string) => {
	if (/^-[ep].+/.test(argument)) { return [ argument.slice(0, 2), argument.slice(2) ] as const }
	const equalsIndex = argument.indexOf('=');

	return equalsIndex === -1 ? [argument, undefined] as const : [argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1)] as const;
};

const consumesValue = (definition: FlagDefinition) => definition.type !== Boolean;

const canonicalNodeFlag = (name: string) => ({ '-e': '--eval', '-p': '--print', '-r': '--require', '-C': '--conditions' })[ name as '-e' | '-p' | '-r' | '-C' ] ?? name.replaceAll('_', '-');

export const canForwardWorkerExecArgv = (argv: string[]) => {
	const workerFlags = new Set([ '--import', '--require', '-r', '--conditions', '-C', '--experimental-strip-types', '--enable-source-maps', '--no-warnings' ]);

	for (let index = 0, length = argv.length; index < length; index += 1) {
		const [ name, inlineValue ] = splitInlineFlag(argv[index]!);

		if (!workerFlags.has(name)) { return false }

		if (inlineValue === undefined && nodeValueFlags.has(name)) { index += 1 }
	}

	return true;
};

export const inheritedExecArgv = (argv: string[], overrides: string[]) => {
	const result: string[] = [];
	const overrideEnd = findFirstPositionalIndex({}, overrides);
	const leadingOverrides = overrideEnd === -1 ? overrides : overrides.slice(0, overrideEnd);

	for (let index = 0, length = argv.length; index < length; index += 1) {
		const argument = argv[index]!;
		const [ name, inlineValue ] = splitInlineFlag(argument);
		const canonicalName = canonicalNodeFlag(name);
		const value = inlineValue === undefined && nodeValueFlags.has(canonicalName) ? argv[++index] : undefined;

		if (['--eval', '--print', '--input-type'].includes(canonicalName)) { continue }

		const repeated = ['--import', '--require', '--conditions'].includes(canonicalName);

		if (leadingOverrides.some((override, overrideIndex) => {
			const [overrideName, overrideValue] = splitInlineFlag(override);
			return canonicalNodeFlag(overrideName) === canonicalName && (!repeated || (overrideValue ?? leadingOverrides[overrideIndex + 1]) === (inlineValue ?? value));
		})) { continue }

		result.push(argument);
		if (value !== undefined) { result.push(value) }
	}

	return result;
};

const nodeValueFlags = new Set([
	'--conditions', '-C', '--import', '--require', '-r', '--loader', '--experimental-loader',
	'--input-type', '--eval', '-e', '--print', '-p', '--inspect-port', '--inspect-publish-uid',
	'--title', '--icu-data-dir', '--openssl-config', '--redirect-warnings', '--trace-event-categories',
	'--trace-event-file-pattern', '--diagnostic-dir', '--report-directory', '--report-filename',
	'--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination',
	'--test-concurrency', '--test-timeout', '--test-shard', '--max-old-space-size', '--max-semi-space-size',
	'--stack-trace-limit', '--env-file', '--env-file-if-exists', '--experimental-default-type'
]);

const flagConsumesNextArgument = (flags: Flags, argument: string) => {
	const [ name, inlineValue ] = splitInlineFlag(argument);

	if (inlineValue !== undefined) { return false }

	const definition = name.startsWith('--') ? getFlagEntry(flags, name.slice(2))?.[1] : getFlagByAlias(flags, name.slice(1))?.[1];

	return definition ? consumesValue(definition) : nodeValueFlags.has(canonicalNodeFlag(name));
};

export const findFirstPositionalIndex = (flags: Flags, argv: string[]) => {
	for (let index = 0, length = argv.length; index < length; index += 1) {
		const argument = argv[index];
		if (argument === undefined) { return -1 }

		if (argument === '--') { return index + 1 }

		if (argument.startsWith('--')) {
			if (flagConsumesNextArgument(flags, argument)) { index += 1 }

			continue;
		}

		if (argument.startsWith('-') && argument.length === 2) {
			if (flagConsumesNextArgument(flags, argument)) { index += 1 }

			continue;
		}

		if (!argument.startsWith('-') || argument === '-') { return index }
	}

	return -1;
};

export const removeArgvFlags = (flags: Flags, argv = process.argv.slice(2)) => {
	for (let index = 0; index < argv.length;) {
		const argument = argv[index];
		if (argument === undefined) { break }

		if (argument === '--' || !argument.startsWith('-') || argument === '-') { break }

		let removeCount = 0;

		if (argument.startsWith('--')) {
			const [ name, inlineValue ] = splitInlineFlag(argument.slice(2));
			const [ , definition ] = getFlagEntry(flags, name) ?? [];
			if (definition) { removeCount = (inlineValue === undefined && consumesValue(definition)) ? 2 : 1 }
		} else if (argument.length === 2) {
			const alias = argument[1];
			const definition = alias === undefined ? undefined : getFlagByAlias(flags, alias)?.[1];
			if (definition) { removeCount = consumesValue(definition) ? 2 : 1 }
		}

		if (removeCount > 0) {
			argv.splice(index, removeCount);
			continue;
		}

		index += flagConsumesNextArgument(flags, argument) ? 2 : 1;
	}

	return argv;
};