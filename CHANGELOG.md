## [1.2.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.1.2...v1.2.0) (2026-08-08)
* **loader:** share scoped hooks across dynamic imports (6881368cd150e8c0dfe088e0431402bbf0f82833)
- adds a shared hook chain for scoped registrations
- prevents per-import native hook churn and teardown races
- ensures virtual in-memory sources short-circuit resolution

* **watch:** stabilize reruns and dependency watching (b5173ba24220b26e6002cd96421ba4cced9a43e6)
- adopts native watcher debounce and direct runtime path watching
- tracks active versus stale runtime dependencies between runs
- serializes reruns to avoid overlapping restart races

* **cli:** run eval in-process with transformed source (92782bbf822ba0be8610a3941e946aa0e54b06bb)
- separates eval script content from passthrough arguments
- gates in-process eval on transformed code availability
- avoids argument-shifting edge cases during execution

* **deps:** upgrade runtime and lint dependency set (966cddd7a8cf6824182bac90ccaecbb2e62c56a3)
- updates package manager and dependency versions together
- aligns lockfile state with declared dependency ranges
- adds release-age exclusion for a newly required runtime dependency

* **bench:** isolate caches and report runner versions (bad18c731fa9d2267c480f4845317aeed6df819f)
- sandboxes benchmark caches to remove cross-run contamination
- preserves compile-cache behavior while clearing transform artifacts
- surfaces compared tool versions for reproducible benchmark output

* **cache:** limit cache sweep parallelism (e65529c6e2124f9cdfcd1d51ffcfd72ddecd7b27)
- adds bounded-concurrency iteration for maintenance work
- prevents unbounded parallel file operations during cache expiry
- keeps cleanup throughput high without overwhelming io resources

* **debug:** serialize debug values without util inspect (9f7152ce90fc64e8e35095469c7e5bd7420229a3)
- removes lazy runtime loading for debug formatting
- adds stable handling for errors, bigint, symbols, functions, and cycles
- keeps debug logging robust under unusual payloads

* **lint:** enforce trailing commas and safer build exits (62e2b871688914f5000e7cc4cd2266fa1d68d471)
- tightens lint behavior for formatting consistency
- converts hard process exits into explicit build errors
- improves failure diagnostics for command execution

* **types:** remove checked-in generated declarations (6b283229040c7c234eed0258fe5d0e62e78e2069)
- removes prebuilt declaration artifacts from version control
- avoids drift between source and generated typings
- reduces noisy diffs caused by rebuild-only output

* remove trailing commas (bde1725f6e41a2e94924de8e3b6296bb1f7c532e)
* updated broken eslint rule (d40980bf293cd229b2d0edef71776d8b1f6d24e5)

## [1.1.2](https://github.com/D1g1talEntr0py/tsnode/compare/v1.1.1...v1.1.2) (2026-08-01)
* add shebang to CLI output and set executable permissions (502d85bbb75a335d1530f2120a19eec30f8bc29f)

## [1.1.1](https://github.com/D1g1talEntr0py/tsnode/compare/v1.1.0...v1.1.1) (2026-08-01)
* optimize IPC connection handling and improve performance by using synchronous file operations (82d37271758c527bc7a0f2c258622d37eadb0b02)
* enhance comparison benchmark implementation to include esmLoaderPath for tsx (6c52a035fbe41391d517c9ebe3210dd1e894429e)

## [1.1.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.0.1...v1.1.0) (2026-08-01)
* implement loader declaration builder and enhance CLI signal handling (cd1470cd83004b34ca6cf8598efa6dd68ebf1944)
* add Copilot instructions and update dependencies in package.json and pnpm-lock.yaml (f5a317a0bb7af0a43c3f7b56945b62040d5231fd)

## [1.0.1](https://github.com/D1g1talEntr0py/tsnode/compare/v1.0.0...v1.0.1) (2026-07-28)
* **deps:** fixes CWE-22 - Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal') (c27f5a34c9d8f96e05c596eb7c0a55d274697443)
The product uses external input to construct a pathname that is intended to identify a file or directory that is located underneath a restricted parent directory, but the product does not properly neutralize special elements within the pathname that can cause the pathname to resolve to a location that is outside of the restricted directory.

## 1.0.0 (2026-07-28)
* Add unit tests for hook resolution, node features, run execution, transform cache, and utilities (6908ca0986da812cff0aef9566915b0b5b0bb048)
- Implement unit tests for hook resolution in `unit-hook-resolve.ts` to validate tsnode protocol requests and namespace handling.
- Create tests for node features in `unit-node-features.ts`, covering feature support checks based on Node.js versions.
- Add tests in `unit-run.ts` to ensure correct environment variable handling and process spawning during execution.
- Introduce `unit-transform-cache.ts` to test caching behavior for transform operations, including memory and disk interactions.
- Develop `unit-transform-index.ts` and `unit-transform-options.ts` to validate type stripping and transformation options.
- Implement `unit-tsconfig.ts` to test loading and resolving TypeScript configuration files.
- Create comprehensive utility tests in `unit-utilities.ts` for various utility functions, including path handling and JSON reading.
- Add capability checks in `utils/node-capabilities.ts` to assess Node.js feature availability.
- Introduce `utils/outdent.ts` for handling multiline string indentation.
- Configure Vitest in `vitest.config.ts` for test execution and coverage reporting.

* replace with ESM-only fork of tsx (28e0aab7311b415e53a4dfe15b65c6e8c9bbfc01)
- Fork of privatenumber/tsx with all CommonJS module handling removed
- Perf: O(1) Map-indexed lazy disk cache (no startup readdirSync)
- Perf: WeakMap-cached tsconfigRaw stringification in transform hash
- Perf: removed hot-path debug log allocations in resolve/load hooks
- Eval mode (-e) now always ESM via --input-type=module
- Rebranded as @d1g1tal/tsnode v1.0.0 with tsx attribution (MIT)

* initial commit (037ff9f477fec457707d514e7e42c29437162933)
* update CLI integration tests to use TypeScript source with resolve hook (c217f0d461a95442ae5699872bf5a4576bee908f)
* **release:** update the publish workflow (70a783c56b49f7f55a8e73be4c7bde4547bc8d02)
