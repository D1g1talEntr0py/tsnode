## [1.3.1](https://github.com/D1g1talEntr0py/tsnode/compare/v1.3.0...v1.3.1) (2026-08-22)


### Bug Fixes

* **release:** simplify semantic-release config and publish flow ([c6d0ed2](https://github.com/D1g1talEntr0py/tsnode/commit/c6d0ed24e84bcf50a230255c066217a9493230ca))

## [1.3.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.2.0...v1.3.0) (2026-08-12)
* **cli:** add in-process support for --print eval mode (901943ef73e3a9188737276d49f8f9043c5931af)
- Introduces runPrintInProcess to mirror node --print completion-value output for transpiled TypeScript
- Tracks transformedPrintCode separately from transformedEvalCode so both paths can run in-process
- Updates canRunEvalInProcess guard to allow either eval or print code to qualify
- Dispatches to the correct runner based on which code variant is present

* **types:** make unregister synchronous and tighten public types (8db51d7be45a431568f1beeb2d32b9c9803bc1eb)
- Changes Unregister return type from Promise<void> to void since no async work is needed
- Narrows ScopedImport return from Promise<any> to Promise<unknown> for better type safety
- Moves virtualSources into the public RegisterOptions type so callers no longer need a cast

* **cli:** prevent async signal handler from floating as unhandled promise (48fd2a8cf39724700e59aa67b2d22f84a5af0430)
- Wraps the async body of relaySignalToChild in void (async () => {})() so the promise is intentionally discarded rather than returned, avoiding potential unhandled-rejection warnings

* **preflight:** prevent floating promise and fix listener override args (f4fe5bedfeb45ae377254aeb0e0dbcfc25b86b73)
- Wraps the async signal-relay startup in void (async () => {})()
- Passes explicit argument arrays to Reflect.apply in listenerCount/listeners overrides instead of the arguments object
- Adds JSDoc to both override methods
- Condenses single-branch if-blocks to one-liners for consistency

* **register:** make unregister callbacks synchronous (ad9441487af011df5a487f9ac0ed582338924827)
- Removes async from both the scoped and global unregister closures, aligning with the updated Unregister type
- Adds JSDoc overload comments to the register() function for better IDE discoverability

* **repl:** prevent floating promise in REPL eval patch (e2c08847ccb1cd6ebe11e1fd6b4f94c445ad9f10)
- Wraps the async transform logic in a void IIFE inside a synchronous REPLEval function
- Switches repl.start override to use rest parameters instead of arguments to avoid implicit-eval lint issues
- Adds JSDoc to the patched eval and start functions

* **suppress-warnings:** tighten process.emit override typing (70f4be2d936ae637a48b0d37b30c67e04c16d808)
- Uses generic event-map typing instead of any for the overridden process.emit
- Guards the warning suppression with an instanceof check to avoid suppressing non-Error warning events
- Uses !! on the Reflect.apply return to guarantee a boolean result

* add JSDoc and tighten empty-catch comments across codebase (e5f54cf0ee4f2d9e4bdcc2f9a40c92764b9fc97b)
- Standardises empty catch blocks with /* ignore */ or /* ignored */ comments to satisfy the no-empty lint rule
- Adds JSDoc to several utility functions (path-utils, watch/index, run-in-process)
- Condenses multi-line try/catch blocks to one-liners where appropriate
- Fixes minor formatting in IPC server (array spacing, missing semicolon)

* **cache:** add JSDoc and minor code quality fixes to FileCache (86ee87c2ea70365f4059f68cfb5f7c01db64cdf1)
- Adds JSDoc to all public and private methods of FileCache
- Wraps setImmediate async callback in void IIFE to avoid floating promise
- Uses void prefix on async flush call inside setImmediate
- Fixes minor comment wording (libuv thread pool, statting -> getting)

* **eslint:** overhaul ESLint flat config (0e5283bc85dc9103d9544b8fc41d8dc81aa02ecf)
- Consolidates onto the unified typescript-eslint package, removing separate parser and plugin imports
- Enables recommendedTypeChecked ruleset for stricter type-aware linting
- Tightens formatting rules: tabs for indentation, single quotes, semicolons with one-liner exemptions
- Enables jsdoc/require-jsdoc for classes and methods to enforce documentation
- Simplifies ignore patterns and removes the separate scripts override block

* **hooks:** add JSDoc to hook utility functions (b92e0c91457906da308e03e8a9f45ff7e057789a)
* **hooks:** minor type safety and code quality improvements (8fb81cbdc550625649b45cd4e067b073e1944d0a)
- Adds explicit cast for Object.create(null) result in resolve.ts to preserve the Record type
- Casts caught unknown errors to Error where rethrown, satisfying use-unknown-in-catch-variables
- Adds eslint-disable comment for a double-quote string literal required by the replace logic
- Simplifies scoped-import by removing an unused type import and unnecessary parentheses
- Simplifies initialize.ts virtualSources access by removing an unnecessary cast
- Simplifies load.ts by removing a redundant guard around parent.send
- Reorders imports in load.ts for consistency

* **transform:** replace formatEsbuildError with a type guard (2181f2f103702b5b4ed04633cb94fb74edf02788)
- Introduces isTransformFailure() to safely identify esbuild TransformFailure objects without casting
- Removes the @ts-expect-error deletes by inlining the mutation at the catch site
- Casts the esbuild module load result to EsbuildModule to restore the inferred type after dynamic require
- Adds JSDoc to stripTypes

* **deps:** bump pnpm and dependency versions (22408a508d8c94949d5c20fc6fbf151bdef166a2)
- Upgrades pnpm from 11.20.0 to 11.21.0
- Updates @d1g1tal/watchr, esbuild, @types/node, eslint, eslint-plugin-jsdoc, and typescript-eslint to latest minor/patch versions
- Removes standalone @typescript-eslint/eslint-plugin and @typescript-eslint/parser in favour of the unified typescript-eslint package
- Adds temporal-polyfill-lite as a transitive dependency of @d1g1tal/watchr 3.2.1
- Removes minimumReleaseAgeExclude workaround from pnpm-workspace.yaml now that watchr 3.2.1 is stable

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
