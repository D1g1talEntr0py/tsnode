# Benchmark

Measures tsnode startup across **scenarios**, **Node versions**, and **project sizes**. Built to isolate where startup time goes — Node's floor, the hook-registration tax, resolution, and transform — rather than one blended number. Motivated by [#809](https://github.com/privatenumber/tsx/issues/809).

## Usage

```sh
pnpm benchmark                                   # all scenarios, current Node, 1000 modules
pnpm benchmark esm-ts --scale                    # per-module cost + fixed startup tax
pnpm --silent benchmark --json > results.json    # raw per-run data
```

Positional arguments select scenarios (default: all).

For `--json`, use `pnpm --silent` so pnpm's script banner stays out of stdout and the redirected file is valid JSON (progress still goes to stderr).

## Scenarios

| Scenario | Default | Runs via | Isolates |
| --- | --- | --- | --- |
| `node-baseline` | ✅ | `node` | Absolute startup floor |
| `hooks-passthrough` | ✅ | tsnode CLI | Hook registration + pass-through resolve/load, **zero transforms** |
| `esm-ts` | ✅ | tsnode CLI | Transform + resolution hot path (`--specifier` applies) |
| `native-ts` | ✅ | `node` | Node's native type stripping — reference floor |

Additional opt-in scenarios cover non-erasable syntax fallback (`esm-ts-enum`, `esm-ts-namespace`, `esm-ts-decorator`), a mixed mostly-erasable tree with sparse fallback modules (`esm-ts-mixed-decorator`), and fork-required CLI startup (`cli-test`).

Running with no scenario names runs the **default set**. All tsnode scenarios run through the **tsnode CLI** (not `--import`) for consistency with real usage; the CLI's extra Node spawn is constant across rows and visible against `node-baseline`.

### Why this default set

Chosen from a full sweep. The four defaults cover distinct, high-signal axes with no redundancy:

- `node-baseline` and `native-ts` are the Node floors needed to interpret the rest (native-ts also exposes tsnode's transform surface as the gap above it).
- `hooks-passthrough` uniquely isolates the hook-registration / worker-thread tax (zero transforms).
- `esm-ts` carries the transform + resolution signal (and reproduces #809).

The default set remains focused on high-signal startup and transform behavior.

## Flags

| Flag | Description | Default |
| --- | --- | --- |
| `-n, --node` | Additional Node version to test, downloaded via get-node (repeatable) | current |
| `-m, --modules` | Module count (ignored with `--scale`) | `1000` |
| `-s, --specifier` | `esm-ts` import style: `ts`, `js`, `extensionless` | `ts` |
| `-r, --runs` | Timed runs per cell | `5` |
| `--cold` | Clear the tsnode transform cache before every run | `false` |
| `--scale` | Sweep module counts 10/100/300/1000; report per-module cost + fixed tax | `false` |
| `--json` | Emit raw per-run results as JSON (stdout) | `false` |

Progress goes to stderr; result tables / JSON to stdout.

## Metrics

- **wall** — parent-measured spawn→exit; the headline, reported as mean ± stdev and **min**. Prefer min when comparing: run-to-run CV was ~6% median in the sweep, and min is the more stable statistic for startup timing.
- **rss** (`--json` only) — peak RSS (`resourceUsage().maxRSS`). Small spread across implementations; useful for checking that loader changes do not move memory independently from wall time.
- **load / eval split** (`--json` only) — each module timestamps its first evaluation; since ESM evaluates post-order, the earliest ≈ "graph loaded/transformed" and the entry's last ≈ "graph evaluated". Eval was a negligible share on synthetic trees, so it's recorded in JSON but kept out of the table.

## Node version axis

tsnode requires Node.js 24.11.1 or newer and always uses sync `module.registerHooks()` (in-thread). Use `--node` to compare supported Node versions, not async-vs-sync hook registration:

```sh
pnpm benchmark hooks-passthrough --node 24.11.1
```

Scenarios below their `minNodeVersion` are skipped, not failed.

## Reproducibility

The tsnode transform cache is reset before each cell's warmup to avoid stale-file skew (a large `$TMPDIR/tsnode-<uid>` degrades warm runs via a linear cache scan). Runs are interleaved after warmup.
