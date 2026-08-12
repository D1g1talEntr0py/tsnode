import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Json, type JsonString } from './json';

export const readJsonFileSync = <JsonType>(filePath: string | URL) => {
	try { return Json.parse(fs.readFileSync(filePath, 'utf8') as JsonString<JsonType>) } catch { /* ignore */ }

	return undefined;
};

export const readJsonFile = async <JsonType>(filePath: string | URL) => {
	try { return Json.parse(await readFile(filePath, 'utf8') as JsonString<JsonType>) } catch { /* ignore */ }

	return undefined;
};
