# Copilot Instructions for tsnode

## Project Intent

- This repository is an ESM-only Node.js TypeScript runner.
- Preserve the ESM-only direction; do not introduce CommonJS compatibility paths unless explicitly requested.
- Prioritize startup and transform-path performance without trading correctness.

## Stack and Runtime Constraints

- Use TypeScript with ESM module semantics.
- Target Node.js 24.11.1+ behavior and APIs.
- Use `pnpm` for all package scripts and dependency operations.

## Source Conventions

- Prefer minimal, surgical edits over broad rewrites.
- Keep comments brief and only where intent is not obvious from code.
- Preserve existing naming and file layout conventions in `src/`, `tests/`, and `scripts/`.
- Prefer lazy imports on cold paths when behavior remains unchanged.
- Avoid adding runtime work to module top-level initialization unless required.

## Performance Rules

When modifying startup, loader, transform, resolve, cache, CLI, or watch code:

- State one concrete bottleneck hypothesis.
- Measure before/after with relevant benchmarks.
- Report both speed and memory impact when feasible.
- Include a concise benchmark-summary section in the final response.
- Prefer removing redundant work before introducing caches.
- If adding a cache, keep it bounded and justify retention behavior.

Recommended benchmark commands:

- `pnpm benchmark:compare`
- `pnpm benchmark`
- `pnpm benchmark:memory`

## Validation Expectations

After code changes, run relevant checks when possible:

- `pnpm type-check` when type-level behavior could be affected
- `pnpm test` for touched behavior or impacted modules
- targeted benchmark command(s) for performance-sensitive edits

If full validation is not run, explicitly state what was skipped.

## Testing Guidance

- Add or update focused tests in `tests/` for behavior changes.
- Prefer targeted unit/integration coverage around modified code paths.
- For benchmark harness changes, preserve comparability and avoid introducing parent-process measurement bias.

## Scope Discipline

- Do not modify unrelated files.
- Public API or CLI behavior changes are allowed when they clearly improve correctness, maintainability, or performance; call out the behavior change explicitly.
- For ambiguous requests that could alter performance methodology or runtime guarantees, ask one focused clarification question before broad changes.
