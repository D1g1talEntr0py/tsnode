# Benchmark

Measures tsnode startup across **scenarios** and **project sizes**. Built to isolate where startup time goes — Node's floor, the hook-registration tax, resolution, and transform — rather than one blended number. Motivated by [#809](https://github.com/privatenumber/tsx/issues/809).

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

Running with no scenario names runs the **default set**. All tsnode scenarios run through the **tsnode CLI** (not `--import`) for consistency with real usage; ordinary CLI invocations run in-process (no extra Node spawn), so these rows reflect the same startup path users get from `tsnode file.ts`.

### Why this default set

Chosen from a full sweep. The four defaults cover distinct, high-signal axes with no redundancy:

- `node-baseline` and `native-ts` are the Node floors needed to interpret the rest (native-ts also exposes tsnode's transform surface as the gap above it).
- `hooks-passthrough` uniquely isolates synchronous in-thread hook registration and dispatch (zero transforms, no loader worker).
- `esm-ts` carries the transform + resolution signal (and reproduces #809).

The default set remains focused on high-signal startup and transform behavior.

## Flags

| Flag | Description | Default |
| --- | --- | --- |
| `-m, --modules` | Module count (ignored with `--scale`) | `1000` |
| `-s, --specifier` | `esm-ts` import style: `ts`, `js`, `extensionless` | `ts` |
| `-r, --runs` | Timed runs per cell | `5` |
| `--cold` | Clear each runner's sandboxed transform cache before every run | `false` |
| `--scale` | Sweep module counts 10/100/300/1000; report per-module cost + fixed tax | `false` |
| `--json` | Emit raw per-run results as JSON (stdout) | `false` |

Progress goes to stderr; result tables / JSON to stdout.

## Metrics

- **wall** — parent-measured spawn→exit; the headline, reported as mean ± stdev and **min**. Prefer min when comparing: run-to-run CV was ~6% median in the sweep, and min is the more stable statistic for startup timing.
- **rss** (`--json` only) — child peak RSS sampled at exit. Linux uses `/proc/self/status` `VmHWM`; other platforms use `resourceUsage().maxRSS`. Separate descendants, including esbuild's service process, are excluded.
- **load / eval split** (`--json` only) — each module timestamps its first evaluation; since ESM evaluates post-order, the earliest ≈ "graph loaded/transformed" and the entry's last ≈ "graph evaluated". Eval was a negligible share on synthetic trees, so it's recorded in JSON but kept out of the table.

JSON `maxRssKb` is the instrumented child's exit-time peak RSS in KiB, not the parent benchmark's allocations. On Linux, `/proc` avoids inherited parent high-water RSS across fork/exec. If `/proc` cannot be read, the reporter falls back to `resourceUsage().maxRSS`, which can retain that bias. Graph evaluation timestamps are captured before exit, independently of this memory sample. Any mitata allocation statistics describe the parent benchmark process, not child peak RSS. `pnpm benchmark:memory` only prints a profiling guide and does not collect a profile.

For child RSS measurements use the JSON harness, or GNU `/usr/bin/time -v` on Linux for a real workload:

```sh
pnpm --silent benchmark esm-ts --modules 1000 --runs 5 --json > results.json
/usr/bin/time -v node dist/cli.js ./fixture.ts
```

Bash's built-in `time` and `TIMEFORMAT` do not support a `%M` peak-memory field. macOS uses `/usr/bin/time -l`, with different output and units. Keep Node version, workload, source-map settings, and cache state consistent when comparing RSS.

## Reproducibility

Runner caches are isolated under a disposable temporary directory and reset before each cell's warmup to avoid stale-file and cross-runner skew. Cold runs clear that sandbox before every measurement while preserving Node's compile cache.
