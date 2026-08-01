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
