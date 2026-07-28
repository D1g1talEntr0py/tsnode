/**
 * Memory profiling guide for the compare benchmark.
 *
 * IMPORTANT: Mitata measures parent process memory (which is identical across
 * all runners since each child process is spawned independently). This guide
 * shows how to properly measure child process memory.
 *
 * Usage:
 *   pnpm benchmark:memory
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║   Memory Profiling Guide for Compare Benchmark                    ║
╚════════════════════════════════════════════════════════════════════╝

PROBLEM:
  Mitata (used in benchmark:compare) measures PARENT process memory,
  not the spawned child processes. This results in identical memory
  readings (~32-40 KB) across all runners.

SOLUTION: Use external profiling tools instead

1. MEASURE PEAK RSS (recommended, Linux/macOS):
   ─────────────────────────────────────────────

   Using /usr/bin/time:
     /usr/bin/time -v node dist/cli.js fixture.ts 2>&1 | grep "Maximum resident"
     /usr/bin/time -v tsx fixture.ts 2>&1 | grep "Maximum resident"

   Using bash built-in time:
     export TIMEFORMAT='RSS: %Mmb'
     time node dist/cli.js fixture.ts

2. NODE PROFILING (detailed heap analysis):
   ─────────────────────────────────────────

   Generate isolate snapshot for analysis:
     node --prof dist/cli.js fixture.ts
     node --prof-process isolate-*.log > profile.txt
     cat profile.txt

   Real-time inspector (DevTools):
     node --inspect-brk dist/cli.js fixture.ts
     # Open chrome://inspect in Chrome

3. MEMORY TIMELINE (Node 18+):
   ──────────────────────────

   Using --expose-gc with tracking:
     node --expose-gc dist/cli.js fixture.ts

4. QUICK COMPARISON:
   ──────────────────

   Run all runners with timing info:
     echo "=== tsnode ===" && time node dist/cli.js fixture.ts
     echo "=== tsnode (import) ===" && time node --import dist/loader.js fixture.ts
     echo "=== baseline ===" && time node fixture.js

WHY THIS HAPPENS:
  • Each runner spawns in isolated process
  • Mitata measures parent process during spawn
  • Parent doesn't allocate memory between iterations
  • Result: identical memory across all runners

NEXT STEPS:
  1. Run 'pnpm benchmark:compare' for timing measurements (these work correctly)
  2. Use /usr/bin/time -v for accurate memory measurements
  3. Compare peak RSS values from external tool output

More info: tests/benchmarks/compare.ts
`);
