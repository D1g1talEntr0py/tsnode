# tsnode

ESM-only Node.js TypeScript runner. Run `.ts` files directly:

```sh
tsnode foo.ts
```

A fork of [tsx](https://github.com/privatenumber/tsx) by [Hiroki Osame](https://github.com/privatenumber), with **all CommonJS handling removed** and the hot paths tuned. ESM is the only module system; CommonJS was always DOA here.

## Why

- **ESM-only.** No `require()` hooks, no `.cts`/`.cjs` transforms, no CJS interop banners, no dual sync/async CJS code paths. Roughly half the loader machinery — gone.
- **Faster.** ~10% faster warm runs, up to ~24% faster with a populated transform cache:
  - Disk cache lookups are O(1) (indexed `Map`) instead of a linear scan of the cache directory.
  - No synchronous cache-directory enumeration at startup.
  - `tsconfigRaw` serialization is cached per project instead of re-stringified per file.
  - Hot-path debug logging allocations removed.
- **Still practical.** Importing CommonJS npm dependencies works — Node's native ESM↔CJS interop handles it. Only *authoring* CommonJS is unsupported.

## Usage

```sh
# Run a TypeScript file
tsnode main.ts

# Watch mode
tsnode watch main.ts

# Eval (always ESM)
tsnode -e 'const n: number = 42; console.log(n)'

# Node --import registration
node --import @d1g1tal/tsnode main.ts
```

### Programmatic API

```ts
import { register, tsImport } from '@d1g1tal/tsnode/esm/api';
```

## What was removed from tsx

- `tsx/cjs` API and all `require()` extension patching
- `.cts` / `.cjs` file support
- CommonJS export pre-parsing, virtual query identities, `module._resolveFilename` interop
- `package.json` `type` walking for format detection (all TypeScript is ESM)

## Requirements

Node.js ≥ 20.19 (native `require(esm)` and `module.registerHooks`).

## License & attribution

MIT. Forked from [privatenumber/tsx](https://github.com/privatenumber/tsx) — the original work is Copyright (c) Hiroki Osame. See [LICENSE](./LICENSE).
