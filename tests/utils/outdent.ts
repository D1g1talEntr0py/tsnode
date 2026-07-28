const trimLeadingAndTrailingBlankLines = (
	text: string,
) => text
	.replace(/^\n+/, '')
	.replace(/\n+\s*$/, '');

const getCommonIndent = (
	lines: string[],
) => {
	let commonIndent = Number.POSITIVE_INFINITY;

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		const indentLength = line.match(/^\s*/)?.[0].length ?? 0;
		commonIndent = Math.min(commonIndent, indentLength);
	}

	return Number.isFinite(commonIndent) ? commonIndent : 0;
};

const dedent = (
	text: string,
) => {
	const normalized = trimLeadingAndTrailingBlankLines(text);
	const lines = normalized.split('\n');
	const commonIndent = getCommonIndent(lines);

	return lines
		.map((line) => line.slice(commonIndent))
		.join('\n');
};

export const outdent = (
	strings: TemplateStringsArray,
	...values: unknown[]
) => {
	let text = '';

	for (let index = 0; index < strings.length; index += 1) {
		text += strings[index];
		if (index < values.length) {
			text += String(values[index]);
		}
	}

	return dedent(text);
};

export default outdent;
