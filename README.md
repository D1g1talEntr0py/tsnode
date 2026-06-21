# tsnode

`tsnode` is a CLI-first TypeScript runner for modern Node.js. It registers synchronous loader hooks and runs local `.ts` entrypoints directly, without requiring loader flags at invocation time.

## Status

This package currently supports the `tsnode` CLI as its public interface. The loader hook implementation is not yet a documented import API.

## Requirements

- Node.js `>=22.15.0`

## Install

```bash
pnpm add -D tsnode
```

You can also install it globally:

```bash
pnpm add -g tsnode
```

## Usage

Run a TypeScript entrypoint directly:

```bash
tsnode ./src/index.ts
```

Arguments after the entry file are passed through to the loaded program:

```bash
tsnode ./scripts/build.ts --watch
```

## What It Resolves

The loader supports these local resolution patterns:

- Relative imports such as `./helper.js` resolving to `./helper.ts`
- Relative paths without an extension resolving to `.ts`
- Directory imports resolving to `index.ts`
- `src/` aliases resolving from the nearest project root containing `tsconfig.json` or `package.json`

## Cache Behavior

- Transpiled output is cached under `~/.cache/tsnode/<typescript-version>`
- Cache keys include the source path, file metadata, current Node version, and TypeScript version
- Cache writes are asynchronous so a cold compile does not block repeated loads in the same process

## Known Limitations

- The package is currently CLI-first; importing loader hooks directly is not yet a supported API
- The transpiler targets modern ESM output for Node.js rather than older runtimes
- Stage 3 decorators are downleveled during transpilation because current Node.js releases still do not execute that syntax directly

## Development

```bash
pnpm run build
pnpm run test
pnpm run type-check
pnpm run release:check
```