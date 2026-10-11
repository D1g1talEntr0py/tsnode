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
- [Preloading with node --import](#preloading-with-node---import)
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
- [Contributing and releases](#contributing-and-releases)
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

`tsnode` registers synchronous in-thread hooks with Node's `module.registerHooks()`. When Node requests a TypeScript module, native `stripTypeScriptTypes()` in strip mode handles supported erasable syntax; esbuild handles syntax requiring transformation. There is no asynchronous loader-worker fallback.

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

3. Type-check in a separate step

```sh
tsc --noEmit
```

## How to choose between tsnode and node --import

`tsnode ./script.ts` is the everyday command. For an ordinary invocation (no leading Node flags, no `--test`, no `-e`/`-p`, not expecting IPC from a parent process), it runs your script in the same process — there's no extra child-process hop, so it has comparable startup overhead to `node --import`.

Use `tsnode` for everyday script execution and whenever you want CLI features:

- `watch`
- `--test`
- REPL
- `-e` / `-p`

Use `node --import @d1g1tal/tsnode` when something else already launches Node directly and you want to preload tsnode's loader into that process — for example a test runner, another CLI, or a programmatic launcher that controls its own `node` invocation.

A few scenarios still spawn a child process even from the `tsnode` CLI: Node flags without a safe runtime equivalent (such as `--inspect`), unsafe inherited parent flags, `--test`, native print (`-p`), or when the parent needs to relay signals/IPC. Eval (`-e`) can run in-process. A leading `--enable-source-maps` alone has a runtime equivalent and does not force a fork; mixing it with unsupported flags preserves the native forked path. Entries that reference `import.meta.main` are forked automatically to preserve main-module identity.

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

Eval can run in-process when the invocation is safe; otherwise it uses a child Node process.

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

Print uses Node's native `--print` in a child process, preserving Node's expression and completion-value semantics rather than approximating them with eval. Node's restrictions on ESM syntax in print expressions still apply.

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

Watcher, dependency-registration, child-spawn, and IPC server errors fail the watch session with diagnostics and cleanup rather than silently losing coverage. Dependency messages are deduplicated and respect socket backpressure. The client queue is bounded to 1 MiB / 1024 messages with 64 KiB frames and reserved control capacity; dependency overflow fails watch explicitly. Stalled delivery times out after five seconds with a warning and disconnects. The server rejects invalid frame lengths or frames over 10 MiB and ignores malformed JSON.

Shutdown preserves a live child's exit status, including `128 + signal` when it exits by signal. A child that has already exited by signal can be rerun or cleaned up without waiting for another exit event.

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

Config files support JSONC comments and trailing commas, relative or package-based `extends`, and arrays of inherited configs. Inherited paths are resolved relative to their declaring config; invalid or cyclic inheritance chains do not load.

## Disable transform cache

In normal use, cache improves repeated execution. During debugging, a cache-free run can be useful.

```sh
tsnode --no-cache ./src/main.ts
```

This bypasses transform-cache reads and writes in both the native-strip and esbuild paths; it does not delete existing cache entries. Node's separate V8 compile cache can be disabled with `NODE_DISABLE_COMPILE_CACHE=1`.

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

## Preloading with node --import

Use `--import` when a tool or script already launches Node directly and you want to preload tsnode's loader into that process, rather than going through the `tsnode` CLI:

```sh
node --import @d1g1tal/tsnode ./src/main.ts
```

Good use cases:

- test runners or other CLIs that invoke `node` themselves
- programmatic launchers that control their own `node` invocation
- Makefile / Docker commands that already run `node` directly

For running a script yourself, prefer the plain CLI:

```sh
tsnode ./src/main.ts
```

Set custom tsconfig for `--import` mode:

```sh
TSNODE_TSCONFIG_PATH=./path/to/tsconfig.custom.json node --import @d1g1tal/tsnode ./main.ts
```

Inject through `NODE_OPTIONS` when another tool launches Node internally:

```sh
NODE_OPTIONS='--import @d1g1tal/tsnode' npx some-binary
```

Caveat: child Node processes inherit `NODE_OPTIONS`, which can add overhead in process-heavy workflows.

Advanced note: a default (execArgv-less) `Worker` or `child_process.fork()` call made from a script running under tsnode correctly inherits the loader hooks, whether the parent ran in-process or was forked.

## Programmatic API

```ts
import { register, tsImport } from '@d1g1tal/tsnode/api';
```

Use the API when you are embedding TypeScript loading into another runtime process.

### register()

`register()` installs loader hooks in the current process.

```ts
import { register } from '@d1g1tal/tsnode/api';

{
  using registration = register();
  await import('./task.ts');
}
```

The handle implements `Disposable`: `using` removes its hooks when the block exits, including when an exception is thrown. TypeScript consumers need `ESNext.Disposable` in their compiler libraries. This works on Node.js 24.11.1+, without relying on the native hook handle to implement disposal.

Manual cleanup remains supported:

```ts
import { register } from '@d1g1tal/tsnode/api';

const api = register();
try {
  await import('./task.ts');
} finally {
  api.unregister();
}
```

Where this is useful:

- worker processes loading TypeScript jobs
- plugin hosts
- runtime utilities that need temporary TS loading support

Scoped namespace example:

```ts
import { register } from '@d1g1tal/tsnode/api';

interface PluginModule {
  activate(): void;
}

{
  using registration = register({ namespace: `tenant-${Date.now()}` });
  const plugin = await registration.import<PluginModule>('./plugin.ts', import.meta.url);
  plugin.activate();
}
```

Use a distinct, nonempty namespace for each independent plugin/task run. Empty namespaces throw `TypeError`. Public registrations own independent native hook handles; unregistering one does not remove another's hooks.

`unregister()` and `[Symbol.dispose]()` are the same synchronous, idempotent cleanup function. Keep the registration alive while loaded modules perform delayed dynamic imports. Cleanup removes hooks, not modules already held in Node's ESM cache; use a new namespace for fresh module identity. Namespace isolation and hook lifetime do not provide module unloading.

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

Without an explicit type argument, imports resolve to `ModuleNamespace` (`Record<string, unknown>`), so export values must be narrowed before use. Supply a module contract when it is known:

```ts
interface TaskModule {
  run(): Promise<void>;
}

const { run } = await tsImport<TaskModule>('./task.ts', import.meta.url);
await run();
```

The generic type is supplied by the caller and does not validate the loaded module at runtime. Validate exports separately when loading untrusted modules.

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

Supply virtual modules as JavaScript source keyed by absolute file or custom-protocol URLs:

```ts
const virtualSources = new Map([
  ['virtual://tasks/task.js', 'export const answer = 42;']
]);
const task = await tsImport<{ answer: number }>('virtual://tasks/task.js', {
  parentURL: import.meta.url,
  tsconfig: false,
  virtualSources
});
```

`register({ namespace, virtualSources })` accepts the same map. Keys omit the internal namespace query. Virtual sources are supplied as ready-to-run JavaScript, not transformed TypeScript.

Equivalent config selections (including unchanged config content), the same `onImport` callback identity, and the same `virtualSources` map identity reuse a scope and therefore reuse module identity for the same resolved URL. A new callback, different map, different config selection, or changed config content selects a different scope. Mutating an existing map does not reload modules already in Node's ESM cache; use a new map for fresh identity.

Successful scopes remain registered for delayed dynamic child imports. Newly created scopes whose imports all fail are released. The fast scope lookup is bounded, but successful scopes and Node's ESM module cache are retained for the process lifetime; this is not an unload API. For explicit isolation and hook cleanup, use `register({ namespace })` with distinct namespaces and `unregister()` instead of `tsImport()`.

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

Registrations use Node's `module.getSourceMapsSupport()` / `module.setSourceMapsSupport()` lifecycle APIs. When tsnode enables maps, it includes dependencies and generated code, matching `process.setSourceMapsEnabled(true)`. It restores the previous `enabled`, `nodeModules`, and `generatedCode` options after its last owning registration is cleaned up. Already-enabled custom settings and later external changes through either Node setter are left untouched.

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

Runtime configuration uses a bundled parser (`src/utils/tsconfig-parser`, derived from `get-tsconfig`) to resolve JSONC and inherited configs without loading the TypeScript compiler. It explicitly selects TypeScript 6 resolution semantics to preserve `baseUrl` support rather than adopting the library's TypeScript 7 default. Path aliases use exact-match and longest-prefix precedence, with unmatched bare imports falling back to an explicitly configured `baseUrl`. Configurations are immutable, and cache identities include the exact contents of inherited files. Malformed config syntax is rejected; transform-option interpretation is delegated to esbuild instead of a separate compiler-option validator.

References:

- [esbuild tsconfig support](https://esbuild.github.io/content-types/#tsconfig-json)
- [esbuild TypeScript caveats](https://esbuild.github.io/content-types/#typescript-caveats)

## Performance and cache behavior

This fork is optimized for fast ESM execution.

Practical guidance:

- warm runs usually benefit from cache reuse
- `--no-cache` is for diagnostics, not normal use
- plain `tsnode ./file.ts` runs in-process and has comparable startup overhead to `node --import`; reach for `--import` when preloading into a process you don't control, not for a speed gain over the CLI

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

### Is node --import faster than tsnode for my quick script?

No — an ordinary `tsnode file.ts` invocation runs in-process (no extra fork), so its overhead is comparable to `node --import`. Reach for `--import` when a tool already launches Node directly and you want to preload the loader into it, not for a speed gain over the CLI.

### Why did my script just fork a child process?

Forks preserve semantics for unsupported leading Node flags, unsafe inherited parent flags, `--test`, native print (`-p`), entries referencing `import.meta.main`, or required signal/IPC relay. Eval can run in-process, and a leading `--enable-source-maps` alone does not force a fork. Ordinary safe script execution does not fork.

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

No. Erasable syntax uses Node's native strip mode; syntax needing transformation falls back to esbuild.

### Is watch mode available through node --import?

No. Watch mode is a tsnode CLI feature.

### Should I always use node --import?

No. Use plain `tsnode ./script.ts` for everyday script execution — it runs in-process with comparable overhead. Reach for `node --import` when another tool already launches Node directly and you want to preload tsnode's loader into it, or for watch/test/repl/eval/print workflows use the `tsnode` CLI directly.

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
- native strip mode preserves locations; esbuild handles non-erasable syntax and other required transforms
- the exact minimum runtime is Node 24.11.1; current compatibility also targets Node 26.10
- contributors to this repository use TypeScript 6.x for type-checking

## Contributing and releases

Run `pnpm lint`, `pnpm type-check`, `pnpm test`, and `pnpm build` before submitting changes. `pnpm type-check` checks both source code and the strict test, benchmark, and build-script configuration; `pnpm type-check:validation` runs just the latter. For coverage, use `NODE_DISABLE_COMPILE_CACHE=1 pnpm test:coverage`. CI validates exact Node 24.11.1 plus the current Node 24 and 26 lines.

Use Conventional Commit messages. `feat` triggers a minor release; `fix`, `perf`, and `revert` trigger a patch release; a `!` marker or `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer triggers a major release. Other commit types do not trigger releases on their own, but every commit is included in the full changelog generated at release time.

The publish workflow runs validation, publishes with npm provenance, commits the generated changelog and package version, then tags the release. Do not manually update the package version or publish as part of ordinary contributions.

## License and attribution

MIT.

Forked from [privatenumber/tsx](https://github.com/privatenumber/tsx), original work Copyright (c) Hiroki Osame.

See [LICENSE](./LICENSE).
