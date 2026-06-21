#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { resolve as resolvePath } from 'node:path';
import { loaderLifecycle, load, resolve } from './hooks.js';

// Use top-level await to ensure the loader is registered before importing the target.
await using _loader = loaderLifecycle;

// Register the TypeScript loader hooks synchronously before importing the target.
registerHooks({ load, resolve });

const entry = process.argv[2];

if (entry === undefined) {
	process.stderr.write('Usage: tsnode <file.ts> [...args]\n');
	process.exit(1);
}

// Shift argv so the target file looks like the main script to the loaded module.
process.argv.splice(1, 1);

await import(entry.startsWith('file:') ? entry : pathToFileURL(resolvePath(entry)).href);