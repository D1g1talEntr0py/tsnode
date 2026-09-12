import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Json, type JsonDecoder, type JsonValue } from './json';

/**
 * Reads a JSON value, or returns a decoder-derived value when a decoder is provided.
 * @param filePath JSON file location.
 * @returns Parsed JSON, or undefined when reading, parsing, or decoding fails.
 */
export function readJsonFileSync(filePath: string | URL): JsonValue | undefined;
export function readJsonFileSync<T>(filePath: string | URL, decoder: JsonDecoder<T>): T | undefined;
export function readJsonFileSync<T>(filePath: string | URL, decoder?: JsonDecoder<T>) {
	try {
		const contents = readFileSync(filePath, 'utf8');
		return decoder ? Json.decode(contents, decoder) : Json.parse(contents);
	} catch { /* ignore */ }

	return undefined;
}

/**
 * Asynchronously reads a JSON value, or returns a decoder-derived value when a decoder is provided.
 * @param filePath JSON file location.
 * @returns Parsed JSON, or undefined when reading, parsing, or decoding fails.
 */
export function readJsonFile(filePath: string | URL): Promise<JsonValue | undefined>;
export function readJsonFile<T>(filePath: string | URL, decoder: JsonDecoder<T>): Promise<T | undefined>;
export async function readJsonFile<T>(filePath: string | URL, decoder?: JsonDecoder<T>) {
	try {
		const contents = await readFile(filePath, 'utf8');
		return decoder ? Json.decode(contents, decoder) : Json.parse(contents);
	} catch { /* ignore */ }

	return undefined;
}
