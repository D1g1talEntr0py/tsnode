# tsnode

[![CI](https://github.com/D1g1talEntr0py/tsnode/actions/workflows/ci.yml/badge.svg)](https://github.com/D1g1talEntr0py/tsnode/actions/workflows/ci.yml)
[![Release](https://github.com/D1g1talEntr0py/tsnode/actions/workflows/publish.yml/badge.svg)](https://github.com/D1g1talEntr0py/tsnode/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/%40d1g1tal%2Ftsnode?color=2f855a)](https://www.npmjs.com/package/@d1g1tal/tsnode)
[![npm downloads](https://img.shields.io/npm/dm/%40d1g1tal%2Ftsnode?color=0b7285)](https://www.npmjs.com/package/@d1g1tal/tsnode)
[![License: MIT](https://img.shields.io/badge/license-MIT-1f6feb.svg)](./LICENSE)

ESM-only Node.js TypeScript runner.

```sh
tsnode foo.ts
```

Forked from [tsx](https://github.com/privatenumber/tsx) by [Hiroki Osame](https://github.com/privatenumber). This fork removes legacy dual-mode branching and focuses on a fast ESM-only path.

## Table of contents

- [What tsnode is](#what-tsnode-is)
- [How tsnode works](#how-tsnode-works)
- [Install](#install)
- [Quick start](#quick-start)
- [How to choose between tsnode and node --import](#how-to-choose-between-tsnode-and-node---import)
- [CLI argument rules](#cli-argument-rules)
- [Run a TypeScript file](#run-a-typescript-file)
- [Pass script arguments](#pass-script-arguments)
- [Eval code (-e)](#eval-code--e)
- [Print expression result (-p)](#print-expression-result--p)
- [REPL](#repl)
- [Watch mode](#watch-mode)
- [Node test runner with TypeScript](#node-test-runner-with-typescript)
- [Custom tsconfig path](#custom-tsconfig-path)
- [Disable transform cache](#disable-transform-cache)
- [Shell scripts](#shell-scripts)
- [Fast path: node --import](#fast-path-node---import)
- [Programmatic API](#programmatic-api)
  - [register()](#register)
  - [tsImport()](#tsimport)
- [Source maps and debugging](#source-maps-and-debugging)
- [Type-checking and compiler behavior](#type-checking-and-compiler-behavior)
- [Performance and cache behavior](#performance-and-cache-behavior)
- [ESM-only expectations](#esm-only-expectations)
- [CLI and environment reference](#cli-and-environment-reference)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [What was removed from tsx](#what-was-removed-from-tsx)
- [Requirements](#requirements)
- [License and attribution](#license-and-attribution)

## What tsnode is

`tsnode` runs TypeScript files directly in Node.js without requiring a separate build step first.

If you normally do this:

1. write `.ts`
2. compile to `.js`
3. run Node on compiled output

`tsnode` simplifies that into one step for runtime execution.

This project is intentionally ESM-only. That focus removes old compatibility branches and keeps runtime behavior and performance easier to reason about.

## How tsnode works

`tsnode` registers a Node loader hook. When Node requests a TypeScript module, that module is transformed on demand and executed.

Important mental model:

- It is runtime transpilation.
- It is not a bundler.
- It is not a type-checker.
- It is built for modern ESM workflows.

Most confusion around this library comes from expecting one of these:

- CommonJS runtime compatibility (`require` workflows)
- Type-checking while executing
- One single "best" command for every scenario

This README is organized to make each scenario explicit.

## Install

### Local project dependency (recommended)

```sh
pnpm add -D @d1g1tal/tsnode
# or
npm i -D @d1g1tal/tsnode
# or
yarn add -D @d1g1tal/tsnode
```

Run from your project:

```sh
pnpm tsnode ./src/main.ts
```

### Global install

```sh
pnpm add -g @d1g1tal/tsnode
# or
npm i -g @d1g1tal/tsnode
# or
yarn global add @d1g1tal/tsnode
```

Then:

```sh
tsnode ./main.ts
```

## Quick start

Use these commands as your baseline:

1. Run a file

```sh
tsnode ./script.ts
```

2. Watch and rerun on change

```sh
tsnode watch ./script.ts
```

3. Fastest one-off execution path

```sh
node --import @d1g1tal/tsnode ./script.ts
```

4. Type-check in a separate step

```sh
tsc --noEmit
```

## How to choose between tsnode and node --import

This is the decision that matters most in day-to-day use.

Use `tsnode` when you want CLI features:

- `watch`
- `--test`
- REPL
- `-e` / `-p`

Use `node --import @d1g1tal/tsnode` when startup overhead is the main concern for plain file execution.

Rule of thumb:

- Feature-rich workflow: use `tsnode`
- Lowest startup overhead for direct script execution: use `node --import`

## CLI argument rules

Argument placement is the most common source of mistakes.

General pattern:

```sh
tsnode [tsnode/node flags] ./entry.ts [script args]
```

Example:

```sh
tsnode --tsconfig ./tsconfig.scripts.json ./scripts/sync.ts --dry-run --verbose
```

How it is interpreted:

- `--tsconfig` configures runtime behavior
- `./scripts/sync.ts` is your script entrypoint
- `--dry-run --verbose` are received by your script via `process.argv`

## Run a TypeScript file

This is the core use case.

```sh
tsnode ./src/main.ts
```

Where this is useful in real projects:

- migration scripts
- release scripts
- data utilities
- internal tooling commands

Real-world example:

```sh
tsnode ./scripts/migrate.ts --environment=staging
```

If your team keeps ops scripts in TypeScript, this is usually your default command.

## Pass script arguments

Arguments after the script path are passed directly to your script.

```sh
tsnode ./scripts/report.ts --since=2026-01-01 --format=json
```

Script example:

```ts
console.log(process.argv.slice(2));
```

Output:

```txt
[ '--since=2026-01-01', '--format=json' ]
```

Where this helps:

- CI pipelines with parameterized scripts
- scheduled jobs with date windows
- safety controls like `--dry-run`

## Eval code (-e)

`-e` runs a TypeScript snippet directly from the command line.

```sh
tsnode -e 'const n: number = 42; console.log(n * 2)'
```

Use this when you need a quick experiment without creating a file.

Real-world examples:

- validating parser behavior against a sample
- quickly reproducing part of a bug
- trying a tiny data transform

## Print expression result (-p)

`-p` evaluates an expression and prints its result.

```sh
tsnode -p 'new Date(0).toISOString()'
```

This is ideal for one-liner checks, shell workflows, and quick normalization logic.

Real-world examples:

- date formatting checks
- quick path/string transformations
- tiny utility evaluations in terminal workflows

## REPL

Running `tsnode` with no arguments starts an interactive TypeScript REPL.

```sh
tsnode
```

This is great for trying ideas before writing files.

You still get normal Node REPL behavior:

- `.help`
- `.exit`
- tab completion
- `_` for last result

## Watch mode

Watch mode reruns your script whenever relevant files change.

```sh
tsnode watch ./src/main.ts
```

Press `Return` to manually rerun.

This is useful when you are in a fast edit/run/debug loop.

Useful watch options:

| Flag | What it helps with |
|---|---|
| `--include <path>` | Add files outside import graph (for example config files) |
| `--exclude <path>` | Ignore generated or noisy files |
| `--clear-screen=false` | Keep previous output visible |
| `--no-cache` | Debug cache-sensitive behavior |
| `--tsconfig <path>` | Use a specific tsconfig for watch session |

Example:

```sh
tsnode watch \
  --include ./config/runtime.json \
  --exclude './generated/*' \
  --clear-screen=false \
  ./src/server.ts
```

## Node test runner with TypeScript

`tsnode --test` enables TypeScript execution for Node's built-in test runner.

```sh
tsnode --test
```

Use this if you already prefer `node:test` and want to keep your test files in TypeScript.

Pattern-based example:

```sh
tsnode --test ./tests/**/*.test.ts
```

This keeps your test runtime simple without adding a separate compile phase just for tests.

## Custom tsconfig path

By default, tsnode finds `tsconfig.json` from the working directory. Use `--tsconfig` when that is not the config you want.

```sh
tsnode --tsconfig ./configs/tsconfig.scripts.json ./scripts/sync.ts
```

Typical cases:

- monorepos
- separate app/tooling/test tsconfig files
- dedicated script/runtime tsconfig

With `node --import`, use:

```sh
TSNODE_TSCONFIG_PATH=./configs/tsconfig.scripts.json node --import @d1g1tal/tsnode ./scripts/sync.ts
```

## Disable transform cache

In normal use, cache improves repeated execution. During debugging, a cache-free run can be useful.

```sh
tsnode --no-cache ./src/main.ts
```

Use this when:

- validating cache invalidation behavior
- investigating stale cache suspicions
- collecting deterministic no-cache timing data

## Shell scripts

You can execute TypeScript files directly as shell scripts using a shebang.

```ts
#!/usr/bin/env tsnode

console.log('argv:', process.argv.slice(2));
```

Make it executable:

```sh
chmod +x ./script.ts
./script.ts hello world
```

This is especially useful for team automation scripts where TypeScript readability is preferable to complex shell script logic.

## Fast path: node --import

For low-overhead direct file execution, use:

```sh
node --import @d1g1tal/tsnode ./src/main.ts
```

Why it is often faster:

- tsnode CLI may spawn a child process depending on mode
- `node --import` runs in a single process

Good use cases:

- short-lived scripts called frequently
- Makefile / Docker commands that already run `node`
- startup-focused benchmarks

Set custom tsconfig for this mode:

```sh
TSNODE_TSCONFIG_PATH=./path/to/tsconfig.custom.json node --import @d1g1tal/tsnode ./main.ts
```

Inject through `NODE_OPTIONS` when another tool launches Node internally:

```sh
NODE_OPTIONS='--import @d1g1tal/tsnode' npx some-binary
```

Caveat: child Node processes inherit `NODE_OPTIONS`, which can add overhead in process-heavy workflows.

Optional helper function:

```sh
# ~/.bashrc or ~/.zshrc
tsnode() {
  case "$1" in
    ""|watch|-e|--eval|-p|--print|--test)
      command tsnode "$@"
      ;;
    *)
      node --import @d1g1tal/tsnode "$@"
      ;;
  esac
}
```

## Programmatic API

```ts
import { register, tsImport } from '@d1g1tal/tsnode/api';
```

Use the API when you are embedding TypeScript loading into another runtime process.

### register()

`register()` installs loader hooks in the current process.

```ts
import { register } from '@d1g1tal/tsnode/api';

const { unregister } = register();

await import('./task.ts');

await unregister();
```

Where this is useful:

- worker processes loading TypeScript jobs
- plugin hosts
- runtime utilities that need temporary TS loading support

Scoped namespace example:

```ts
import { register } from '@d1g1tal/tsnode/api';

const api = register({ namespace: `tenant-${Date.now()}` });

const moduleA = await api.import('./plugin.ts', import.meta.url);

await api.unregister();
```

This helps isolate module loading between independent plugin/task runs.

Track imports with `onImport`:

```ts
import { register } from '@d1g1tal/tsnode/api';

register({
  onImport(url) {
    console.log('Loaded:', url);
  }
});
```

### tsImport()

`tsImport()` dynamically imports a TypeScript module with targeted registration behavior.

Basic use:

```ts
import { tsImport } from '@d1g1tal/tsnode/api';

const loaded = await tsImport('./task.ts', import.meta.url);
```

Object form:

```ts
import { tsImport } from '@d1g1tal/tsnode/api';

const loaded = await tsImport('./task.ts', {
  parentURL: import.meta.url,
  tsconfig: './tsconfig.tools.json',
  onImport(url) {
    console.log(url);
  }
});
```

Disable tsconfig lookup for a specific import:

```ts
await tsImport('./task.ts', {
  parentURL: import.meta.url,
  tsconfig: false
});
```

Use this when you want dynamic TS imports without permanently changing unrelated runtime imports.

## Source maps and debugging

Source maps turn stack traces and debugger locations back into TypeScript lines.

Source maps are enabled automatically when Node starts with:

- `--enable-source-maps`
- any `--inspect*` flag
- `NODE_V8_COVERAGE`

Force source maps on for non-debug runs:

```sh
TSNODE_SOURCE_MAPS=1 tsnode ./src/main.ts
```

## Type-checking and compiler behavior

tsnode runs code; it does not replace static type-checking.

Run type-checking separately:

```sh
tsc --noEmit
```

Recommended workflow:

- run with tsnode for execution speed
- validate with `tsc --noEmit` in CI/pre-commit

Compiler caveats inherited from esbuild:

- `eval()` compatibility semantics are not preserved
- only a subset of tsconfig options affect transforms
- `emitDecoratorMetadata` is not supported

References:

- [esbuild tsconfig support](https://esbuild.github.io/content-types/#tsconfig-json)
- [esbuild TypeScript caveats](https://esbuild.github.io/content-types/#typescript-caveats)

## Performance and cache behavior

This fork is optimized for fast ESM execution.

Practical guidance:

- warm runs usually benefit from cache reuse
- `--no-cache` is for diagnostics, not normal use
- `node --import` is usually best for startup-sensitive one-off runs

Benchmark whichever path matches your real workload:

- `tsnode ./file.ts`
- `node --import @d1g1tal/tsnode ./file.ts`

## ESM-only expectations

This runtime expects modern ESM usage.

In practice:

- use `import` / `export`
- do not rely on legacy CommonJS runtime patching
- align project scripts and tooling around ESM behavior

If migrating from mixed CJS/ESM code, convert runtime scripts to ESM first, then switch execution to tsnode.

## CLI and environment reference

### CLI flags

| Flag | Meaning |
|---|---|
| `--help`, `-h` | Show CLI help |
| `--version`, `-v` | Show tsnode version |
| `--tsconfig <path>` | Use a specific tsconfig |
| `--no-cache` | Disable transform cache |
| `--test` | Run Node test runner with TS support |
| `--eval`, `-e <code>` | Evaluate code |
| `--print`, `-p <expr>` | Evaluate and print expression |

Watch subcommand options:

| Flag | Meaning |
|---|---|
| `watch --include <path>` | Add extra watch targets |
| `watch --exclude <path>` | Exclude paths from watch |
| `watch --clear-screen=false` | Keep output between reruns |

### Environment variables

| Variable | Effect |
|---|---|
| `TSNODE_TSCONFIG_PATH` | Set tsconfig path (especially with `node --import`) |
| `TSNODE_SOURCE_MAPS=1` | Force source maps on |
| `NODE_OPTIONS=--import @d1g1tal/tsnode` | Inject loader into tools that launch Node internally |

## Troubleshooting

### Why are my types not being checked?

Because tsnode executes TypeScript but does not perform static type-checking. Run `tsc --noEmit` separately.

### Why is node --import faster than tsnode for my quick script?

`node --import` avoids some CLI/process overhead and is often faster for short-lived runs.

### Why does my CommonJS script not work?

This project is ESM-only. Convert runtime scripts to ESM module patterns.

### Why are my stack traces not mapped to .ts lines?

Enable source maps explicitly:

```sh
TSNODE_SOURCE_MAPS=1 tsnode ./src/main.ts
```

## FAQ

### Is this a drop-in replacement for every Node + TS setup?

It is a strong drop-in for ESM-first runtime workflows. It is not a drop-in for legacy CommonJS runtime setups.

### Do I need typescript installed at runtime?

No. Runtime transforms are handled by esbuild.

### Is watch mode available through node --import?

No. Watch mode is a tsnode CLI feature.

### Should I always use node --import?

Use it when startup overhead is your bottleneck. For watch/test/repl/eval/print workflows, use tsnode CLI.

## What was removed from tsx

- CommonJS runtime support (`require` patching, `tsx/cjs` entry)
- Legacy dual-mode API/extension compatibility layers
- Legacy export pre-parsing and old interop shims
- `package.json` type walking for module mode detection

This fork assumes TypeScript files execute as ESM.

## Requirements

- Node.js >= 24.11.1

TypeScript runtime details:

- no local `typescript` package is required at runtime
- transforms are handled by esbuild (with native stripping where available)
- contributors to this repository use TypeScript 6.x for type-checking

## License and attribution

MIT.

Forked from [privatenumber/tsx](https://github.com/privatenumber/tsx), original work Copyright (c) Hiroki Osame.

See [LICENSE](./LICENSE).
