/**
 * Memory profiling guide for the compare benchmark.
 *
 * Mitata memory rows measure parent allocations, not child peak RSS.
 * This script prints guidance only; it does not collect a memory profile.
 *
 * Usage:
 *   pnpm benchmark:memory
 */

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║   Memory Profiling Guide for Compare Benchmark                    ║
╚════════════════════════════════════════════════════════════════════╝

PROBLEM:
  Mitata (used in benchmark:compare) measures PARENT process memory,
  not the spawned child processes. Spawn and cleanup allocations can
  differ between runners; those rows are not child memory measurements.

This command prints a guide only. It does not collect a profile.

SOLUTION: Use the JSON harness or external profiling tools

1. MEASURE PEAK RSS:
   ─────────────────────────────────────────────

   Instrumented child maxRSS in KiB (JSON rss field):
     pnpm --silent benchmark esm-ts --modules 1000 --runs 5 --json > results.json

   Using GNU /usr/bin/time on Linux:
     /usr/bin/time -v node dist/cli.js fixture.ts 2>&1 | grep "Maximum resident"
     /usr/bin/time -v tsx fixture.ts 2>&1 | grep "Maximum resident"

   On macOS use /usr/bin/time -l (different output and units).
   Bash built-in time / TIMEFORMAT has no %M peak-memory field.

2. NODE PROFILING (detailed heap analysis):
   ─────────────────────────────────────────

   Generate a heap profile:
     node --heap-prof dist/cli.js fixture.ts

   CPU profiling (not a heap snapshot):
     node --prof dist/cli.js fixture.ts
     node --prof-process isolate-*.log > profile.txt
     cat profile.txt

   Real-time inspector (DevTools):
     node --inspect-brk dist/cli.js fixture.ts
     # Open chrome://inspect in Chrome

3. MEMORY SAMPLING (Node 24.11.1+):
   ──────────────────────────

   If your fixture explicitly samples process.memoryUsage():
     node --expose-gc dist/cli.js fixture.ts
   --expose-gc only exposes globalThis.gc(); it does not record a timeline.

4. QUICK COMPARISON:
   ──────────────────

   Run all runners with timing info:
     echo "=== tsnode ===" && time node dist/cli.js fixture.ts
     echo "=== tsnode (import) ===" && time node --import dist/loader.js fixture.ts
     echo "=== baseline ===" && time node fixture.js

WHY THIS HAPPENS:
  • Each runner spawns in isolated process
  • Mitata measures parent process during spawn
  • Parent allocations do not report the child's peak RSS

NEXT STEPS:
  1. Run 'pnpm benchmark:compare' for timing measurements (these work correctly)
  2. Use JSON child maxRSS or Linux /usr/bin/time -v for peak RSS
  3. Compare with the same Node version, workload, maps, and cache state

More info: tests/benchmarks/compare.ts
`);
