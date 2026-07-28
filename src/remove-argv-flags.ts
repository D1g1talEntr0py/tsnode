export type FlagDefinition = {
	type: BooleanConstructor | StringConstructor | NumberConstructor | [StringConstructor];
	alias?: string;
};

export type Flags = Record<string, FlagDefinition>;

const toCamelCase = (value: string) => value.replace(/-([a-z])/g, (_, character: string) => character.toUpperCase());

const getFlagEntry = (flags: Flags, name: string) => {
	if (name in flags) { return [ name, flags[name] ] as const }

	const camelName = toCamelCase(name);

	return camelName in flags ? [ camelName, flags[camelName] ] as const : undefined;
};

const getFlagByAlias = (flags: Flags, alias: string) => {
	for (const name in flags) {
		const definition = flags[name];
		if (definition.alias === alias) { return [ name, definition ] as const }
	}

	return undefined;
};

const splitInlineFlag = (argument: string) => {
	const equalsIndex = argument.indexOf('=');

	return equalsIndex === -1 ? [argument, undefined] as const : [argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1)] as const;
};

const consumesValue = (definition: FlagDefinition) => definition.type !== Boolean;

export const findFirstPositionalIndex = (flags: Flags, argv: string[]) => {
	for (let index = 0, length = argv.length; index < length; index += 1) {
		const argument = argv[index];

		if (argument === '--') { return index + 1 }

		if (argument.startsWith('--')) {
			const [ name, inlineValue ] = splitInlineFlag(argument.slice(2));
			const entry = getFlagEntry(flags, name);

			if (entry && inlineValue === undefined && consumesValue(entry[1])) { index += 1 }

			continue;
		}

		if (argument.startsWith('-') && argument.length === 2) {
			const [ , definition ] = getFlagByAlias(flags, argument[1]) ?? [];

			if (definition && consumesValue(definition)) { index += 1 }

			continue;
		}

		if (!argument.startsWith('-') || argument === '-') { return index }
	}

	return -1;
};

export const removeArgvFlags = (flags: Flags, argv = process.argv.slice(2)) => {
	for (let index = 0; index < argv.length;) {
		const argument = argv[index];

		if (argument === '--' || !argument.startsWith('-') || argument === '-') { break }

		let removeCount = 0;

		if (argument.startsWith('--')) {
			const [ name, inlineValue ] = splitInlineFlag(argument.slice(2));
			const [ , definition ] = getFlagEntry(flags, name) ?? [];
			if (definition) { removeCount = (inlineValue === undefined && consumesValue(definition)) ? 2 : 1 }
		} else if (argument.length === 2) {
			const [ , definition ] = getFlagByAlias(flags, argument[1]) ?? [];
			if (definition) { removeCount = consumesValue(definition) ? 2 : 1 }
		}

		if (removeCount > 0) {
			argv.splice(index, removeCount);
			continue;
		}

		index += 1;
	}

	return argv;
};