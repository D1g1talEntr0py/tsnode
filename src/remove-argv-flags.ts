import type { FlagDefinition, Flags } from './types';
export type { FlagDefinition, Flags } from './types';

const canonicalFlags: Record<string, string> = { '-e': '--eval', '-p': '--print', '-r': '--require', '-C': '--conditions' };
const workerFlags = new Set([ '--import', '--require', '-r', '--conditions', '-C', '--experimental-strip-types', '--enable-source-maps', '--no-warnings' ]);
const nodeValueFlags = new Set([
	'--conditions', '-C', '--import', '--require', '-r', '--loader', '--experimental-loader',
	'--input-type', '--eval', '-e', '--print', '-p', '--inspect-port', '--inspect-publish-uid',
	'--title', '--icu-data-dir', '--openssl-config', '--redirect-warnings', '--trace-event-categories',
	'--trace-event-file-pattern', '--diagnostic-dir', '--report-directory', '--report-filename',
	'--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination',
	'--test-concurrency', '--test-timeout', '--test-shard', '--max-old-space-size', '--max-semi-space-size',
	'--stack-trace-limit', '--env-file', '--env-file-if-exists', '--experimental-default-type'
]);

/**
 * Converts a single character to uppercase.
 * @param _ The full match (ignored).
 * @param character The character to convert to uppercase.
 * @returns The uppercase version of the character.
 */
const toUpperCase = (_: string, character: string) => character.toUpperCase();

/**
 * Converts a kebab-case string to camelCase.
 * @param value The string to convert.
 * @returns The camelCase version of the string.
 */
const toCamelCase = (value: string) => value.replace(/-([a-z])/g, toUpperCase);

/**
 * Retrieves the flag entry for the given name, considering both the original and camelCase versions.
 * @param flags The collection of flags to search.
 * @param name The name of the flag to retrieve.
 * @returns A tuple containing the flag name and its definition, or `undefined` if not found.
 */
const getFlagEntry = (flags: Flags, name: string) => {
	const definition = flags[name];

	if (definition) { return [ name, definition ] as const }

	const camelName = toCamelCase(name);
	const camelDefinition = flags[camelName];

	return camelDefinition ? [ camelName, camelDefinition ] as const : undefined;
};

/**
 * Retrieves the flag entry for the given alias.
 * @param flags The collection of flags to search.
 * @param alias The alias of the flag to retrieve.
 * @returns A tuple containing the flag name and its definition, or `undefined` if not found.
 */
const getFlagByAlias = (flags: Flags, alias: string) => {
	for (const name in flags) {
		const definition = flags[name];
		if (definition?.alias === alias) { return [ name, definition ] as const }
	}

	return undefined;
};

/**
 * Splits an inline flag into its name and value components.
 * @param argument The command-line argument to split.
 * @returns A tuple containing the flag name and its value, or `undefined` if no value is present.
 */
const splitInlineFlag = (argument: string) => {
	if (/^-[ep].+/.test(argument)) { return [ argument.slice(0, 2), argument.slice(2) ] }

	const equalsIndex = argument.indexOf('=');

	return equalsIndex === -1 ? [ argument, undefined ] as const : [ argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1) ];
};

/**
 * Determines whether a flag definition consumes a value.
 * @param definition The flag definition to check.
 * @returns `true` if the flag consumes a value, `false` otherwise.
 */
const consumesValue = (definition: FlagDefinition) => definition.type !== Boolean;

/**
 * Converts a Node.js flag to its canonical form.
 * @param name The flag name to convert.
 * @returns The canonical form of the flag name.
 */
const canonicalNodeFlag = (name: string) => canonicalFlags[name] ?? name.replaceAll('_', '-');

/**
 * Determines whether the given Node.js exec argument vector can be forwarded to a worker process.
 * @param argv The Node.js exec argument vector to check.
 * @returns `true` if all arguments can be forwarded, `false` otherwise.
 */
export const canForwardWorkerExecArgv = (argv: string[]) => {
	for (let index = 0, length = argv.length; index < length; index += 1) {
		const [ name, inlineValue ] = splitInlineFlag(argv[index]!);

		if (!workerFlags.has(name)) { return false }

		if (inlineValue === undefined && nodeValueFlags.has(name)) { index += 1 }
	}

	return true;
};

/**
 * Inherits Node.js exec argument vector, applying overrides where specified.
 * @param argv The original Node.js exec argument vector.
 * @param overrides The overrides to apply.
 * @returns The inherited exec argument vector with overrides applied.
 */
export const inheritedExecArgv = (argv: string[], overrides: string[]) => {
	const result: string[] = [];
	const overrideEnd = findFirstPositionalIndex({}, overrides);
	const leadingOverrides = overrideEnd === -1 ? overrides : overrides.slice(0, overrideEnd);

	for (let index = 0, length = argv.length; index < length; index += 1) {
		const argument = argv[index]!;
		const [ name, inlineValue ] = splitInlineFlag(argument);
		const canonicalName = canonicalNodeFlag(name);
		const value = inlineValue === undefined && nodeValueFlags.has(canonicalName) ? argv[++index] : undefined;

		if ([ '--eval', '--print', '--input-type' ].includes(canonicalName)) { continue }

		if (leadingOverrides.some((override, overrideIndex) => {
			const [overrideName, overrideValue] = splitInlineFlag(override);
			const repeated = [ '--import', '--require', '--conditions' ].includes(canonicalName);

			return canonicalNodeFlag(overrideName) === canonicalName && (!repeated || (overrideValue ?? leadingOverrides[overrideIndex + 1]) === (inlineValue ?? value));
		})) { continue }

		result.push(argument);

		if (value !== undefined) { result.push(value) }
	}

	return result;
};

/**
 * Determines whether the given Node.js exec argument consumes the next argument.
 * @param flags The set of known flags.
 * @param argument The argument to check.
 * @returns `true` if the argument consumes the next argument, `false` otherwise.
 */
const flagConsumesNextArgument = (flags: Flags, argument: string) => {
	const [ name, inlineValue ] = splitInlineFlag(argument);

	if (inlineValue !== undefined) { return false }

	const definition = name.startsWith('--') ? getFlagEntry(flags, name.slice(2))?.[1] : getFlagByAlias(flags, name.slice(1))?.[1];

	return definition ? consumesValue(definition) : nodeValueFlags.has(canonicalNodeFlag(name));
};

/**
 * Finds the index of the first positional argument in the given Node.js exec argument vector.
 * @param flags The set of known flags.
 * @param argv The Node.js exec argument vector to search.
 * @returns The index of the first positional argument, or `-1` if none is found.
 */
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
	for (let index = 0, length = argv.length; index < length;) {
		const argument = argv[index];

		if (argument === undefined || argument === '--' || !argument.startsWith('-') || argument === '-') { break }

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