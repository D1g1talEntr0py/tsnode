# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.4.0...v1.5.0) - 2026-10-15



### Features
* **core:** modernize runtime and watch behavior ([120da54](https://github.com/D1g1talEntr0py/tsnode/commit/120da54d14b53152fb8badd5e336da0ac48604e8))







### Chores
* **repo:** update CI and documentation ignore policy ([523c848](https://github.com/D1g1talEntr0py/tsnode/commit/523c8485de5029cbcb37c1b0eee15293f4e615fc))







## [1.4.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.3.5...v1.4.0) - 2026-10-11



### Features
* **api:** strengthen scoped loader registrations ([9734175](https://github.com/D1g1talEntr0py/tsnode/commit/973417576c6d285772fa48506025e071a9e40467))


### Bug Fixes
* **tsconfig:** parse configs with TypeScript semantics ([0225108](https://github.com/D1g1talEntr0py/tsnode/commit/022510827d1e0bdf66304bfec89d88e36f0078a3))

### Bug Fixes
* **tsconfig:** declare immutable config type for parser ([1af9713](https://github.com/D1g1talEntr0py/tsnode/commit/1af971341ef1404dfd61e84de5faaccb36683945))

### Bug Fixes
* **cli:** preserve Node execution semantics ([f91c0e6](https://github.com/D1g1talEntr0py/tsnode/commit/f91c0e67d70a268809200fafd818acd733df6224))

### Bug Fixes
* **watch:** bound IPC and child shutdown ([b8c9fd5](https://github.com/D1g1talEntr0py/tsnode/commit/b8c9fd5f8c3d46e60ea80685573a30eb5af38412))

### Bug Fixes
* **build:** prefer ESM entry points for bundled dependencies ([012c38d](https://github.com/D1g1talEntr0py/tsnode/commit/012c38dc220188c6ac175a56fb9d846b1eab8b5d))

### Bug Fixes
* **build:** include referenced API types in declarations ([0c99a4f](https://github.com/D1g1talEntr0py/tsnode/commit/0c99a4f2a7534b899c0efce71f863456bdb68021))

### Bug Fixes
* **tsconfig:** align parser type contracts ([dba2143](https://github.com/D1g1talEntr0py/tsnode/commit/dba214388f598c577859f5dedec61de2e9846ad6))




### Documentation
* **release:** document release policy ([eb4c98b](https://github.com/D1g1talEntr0py/tsnode/commit/eb4c98be194d428c22b146eb78841dd380b15ad1))

### Documentation
* document runtime behavior and benchmark guidance ([d39acfc](https://github.com/D1g1talEntr0py/tsnode/commit/d39acfcbf5f83d3253112f8c49a182694053292e))

### Documentation
* **cache:** document cache behavior ([ffc8a8b](https://github.com/D1g1talEntr0py/tsnode/commit/ffc8a8b3a15a214cdad8ab0d20f20667f0ea84b5))



### Chores
* **deps:** update package tooling dependencies ([bb2d0b2](https://github.com/D1g1talEntr0py/tsnode/commit/bb2d0b29aafca10cbea345b1ac1588692bf76f44))

### Chores
* **deps:** update package tooling dependencies ([a848537](https://github.com/D1g1talEntr0py/tsnode/commit/a8485371a23ca6b004df62bd49d5b33beb7a3cfe))

### Chores
* **validation:** type-check tests and build scripts ([a61ef43](https://github.com/D1g1talEntr0py/tsnode/commit/a61ef436e56001bb4e5b1bad39114a30745f4409))

### Chores
* **release:** 1.4.0 [skip ci] ([8b8e82f](https://github.com/D1g1talEntr0py/tsnode/commit/8b8e82f34bec879246a63fe3218b18990d2d18a6))



### Tests
* fix stdin end call in runtime integration test ([d44433d](https://github.com/D1g1talEntr0py/tsnode/commit/d44433d436469a82c6d1bde2216771ce3d873966))

### Tests
* **fixtures:** add deterministic child environment helper ([12b3f62](https://github.com/D1g1talEntr0py/tsnode/commit/12b3f6228d4b71323f808531807a14e55a850fc6))



### Continuous Integration
* **release:** migrate publishing to git-cliff ([b29ec06](https://github.com/D1g1talEntr0py/tsnode/commit/b29ec06b193fc442d6759190f79831d7ee5614d1))

### Continuous Integration
* test minimum Node version and disable compile cache for coverage ([27456d8](https://github.com/D1g1talEntr0py/tsnode/commit/27456d839643a3b8d02b8d7fe039e548ed7ea012))



## [1.3.5](https://github.com/D1g1talEntr0py/tsnode/compare/v1.3.4...v1.3.5) - 2026-09-12







### Documentation
* update readme with performance and review guidelines ([e884bd3](https://github.com/D1g1talEntr0py/tsnode/commit/e884bd3802fb82e19f9dcd38d2a91457b288776e))



### Chores
* **deps:** update runtime and development dependencies ([e6edd74](https://github.com/D1g1talEntr0py/tsnode/commit/e6edd7445b7807c2611193eb206cd95c3d4ce93a))

### Chores
* **release:** 1.3.5 [skip ci] ([200a62d](https://github.com/D1g1talEntr0py/tsnode/commit/200a62dc4059b8c4815da58d6cdcbfa65875e5d9))


### Code Refactoring
* **node:** remove obsolete warning suppression and legacy capability checks ([a748d11](https://github.com/D1g1talEntr0py/tsnode/commit/a748d118f234c813875245ecd32de2e8d124980d))

### Code Refactoring
* **types:** centralize type definitions and automate declaration generation ([4502f91](https://github.com/D1g1talEntr0py/tsnode/commit/4502f91e727c17d59293b469a8edaf2e50bcecd5))

### Code Refactoring
* **core:** enforce strict compiler settings and add runtime type guards ([5e63d07](https://github.com/D1g1talEntr0py/tsnode/commit/5e63d07d3835f3ef4cb3396d142db6026ac2ab94))


### Tests
* align test suites and benchmarks with strict types and Node 24 ([1f2c5d4](https://github.com/D1g1talEntr0py/tsnode/commit/1f2c5d4ed8c80a4bf81d3d5bc8180c4ffdd4b2ca))

### Tests
* replace fixed turn count with polling for unlink checks ([e1dbdb0](https://github.com/D1g1talEntr0py/tsnode/commit/e1dbdb0ff583022feb57b850d32b75f0a76759a8))





## [1.3.4](https://github.com/D1g1talEntr0py/tsnode/compare/v1.3.3...v1.3.4) - 2026-09-05




### Bug Fixes
* **cli:** preserve entrypoint semantics in fast path ([9b4e9d1](https://github.com/D1g1talEntr0py/tsnode/commit/9b4e9d193efcf0e2815ddc58c5d5ced8672ab769))

### Bug Fixes
* **ci:** parse commit message boundaries correctly ([e6d1f17](https://github.com/D1g1talEntr0py/tsnode/commit/e6d1f171fe3d24007df2aa8ca0d31731165f0241))

### Bug Fixes
* **ci:** restore the unstable_native_nodejs_ts_config flag ([f419d1b](https://github.com/D1g1talEntr0py/tsnode/commit/f419d1b90faf70a15ee0c279e3d5aa9a719e5dd5))




### Documentation
* clarify CLI and node import execution guidance ([f3dc0a5](https://github.com/D1g1talEntr0py/tsnode/commit/f3dc0a58f2b9aaf2c6e3db0e5a4e4b362d255695))



### Chores
* **ci:** add validation for Conventional Commit message boundaries ([f99ec7b](https://github.com/D1g1talEntr0py/tsnode/commit/f99ec7b81f8884f726f387af1610763a58dbb891))

### Chores
* **deps:** update development tooling dependencies ([e309b06](https://github.com/D1g1talEntr0py/tsnode/commit/e309b065406c6ab87e8d44a7e35cab9557a578b0))

### Chores
* **release:** 1.3.4 [skip ci] ([5b883f6](https://github.com/D1g1talEntr0py/tsnode/commit/5b883f61cf32182951fa3056cf6e4a33a0071485))



### Tests
* **benchmarks:** separate cold timing and add percentile reporting ([7fb04c7](https://github.com/D1g1talEntr0py/tsnode/commit/7fb04c71e99daf06869693360a850481411c2c9d))





## [1.3.3](https://github.com/D1g1talEntr0py/tsnode/compare/v1.3.2...v1.3.3) - 2026-08-29




### Bug Fixes
* **release:** got the commit order wrong in order for a new release to generate. ([b43a768](https://github.com/D1g1talEntr0py/tsnode/commit/b43a768daeb6ab3f8dd719f9d46c15e1b2fcb770))






### Chores
* chore(deps): update pretty-ms to version 9.3.1 and adjust related references
refactor: improve IPC handling in load hook and clean up fixture cleanup logic
test: streamline integration load test by removing unnecessary environment variable ([008935f](https://github.com/D1g1talEntr0py/tsnode/commit/008935fb56ebca622dd257b9dd9172e1bf5f91be))

### Chores
* **release:** 1.3.3 [skip ci] ([8cf159c](https://github.com/D1g1talEntr0py/tsnode/commit/8cf159c75feabae7773f3f0a2664591ddfeec4e8))







## [1.3.2](https://github.com/D1g1talEntr0py/tsnode/compare/v1.3.1...v1.3.2) - 2026-08-29




### Bug Fixes
* **release:** remove invalid '-s' argument from the build ([3d60f7e](https://github.com/D1g1talEntr0py/tsnode/commit/3d60f7e486a1614f85ff6efa94dda2a336511701))






### Chores
* **deps:** migrate to c8 coverage tool and update dependencies ([3d19c57](https://github.com/D1g1talEntr0py/tsnode/commit/3d19c57db79f9a716f94d80896fdae6376688b5a))

### Chores
* **release:** 1.3.2 [skip ci] ([c7889a0](https://github.com/D1g1talEntr0py/tsnode/commit/c7889a0a20ed52179ace4d695be22ac30fb9f367))


### Code Refactoring
* improve IPC server message handling and add tests ([47018ca](https://github.com/D1g1talEntr0py/tsnode/commit/47018caf5eebf30d0f6c239f30af319bb0dba864))

### Code Refactoring
* add test infrastructure and benchmark improvements ([07db467](https://github.com/D1g1talEntr0py/tsnode/commit/07db467764ae2b517accb45ff3aeb30f2e42be4b))


### Tests
* add comprehensive test suites for integration and unit testing ([e9ebf98](https://github.com/D1g1talEntr0py/tsnode/commit/e9ebf9860c9abeb995e2e25058410b0688e122d4))





## [1.3.1](https://github.com/D1g1talEntr0py/tsnode/compare/v1.3.0...v1.3.1) - 2026-08-22




### Bug Fixes
* **release:** simplify semantic-release config and publish flow ([c6d0ed2](https://github.com/D1g1talEntr0py/tsnode/commit/c6d0ed24e84bcf50a230255c066217a9493230ca))






### Chores
* **deps:** bump pnpm and dependency versions ([97b4060](https://github.com/D1g1talEntr0py/tsnode/commit/97b40601cb3ba668890140b8e184e25b208679d1))

### Chores
* **release:** 1.3.1 [skip ci] ([757f59b](https://github.com/D1g1talEntr0py/tsnode/commit/757f59bc288355f6dc4d1b0fa9160d408d772ec4))







## [1.3.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.2.0...v1.3.0) - 2026-08-12



### Features
* **types:** make unregister synchronous and tighten public types ([8db51d7](https://github.com/D1g1talEntr0py/tsnode/commit/8db51d7be45a431568f1beeb2d32b9c9803bc1eb))

### Features
* **cli:** add in-process support for --print eval mode ([901943e](https://github.com/D1g1talEntr0py/tsnode/commit/901943ef73e3a9188737276d49f8f9043c5931af))


### Bug Fixes
* **register:** make unregister callbacks synchronous ([ad94414](https://github.com/D1g1talEntr0py/tsnode/commit/ad9441487af011df5a487f9ac0ed582338924827))

### Bug Fixes
* **cli:** prevent async signal handler from floating as unhandled promise ([48fd2a8](https://github.com/D1g1talEntr0py/tsnode/commit/48fd2a8cf39724700e59aa67b2d22f84a5af0430))

### Bug Fixes
* **repl:** prevent floating promise in REPL eval patch ([e2c0884](https://github.com/D1g1talEntr0py/tsnode/commit/e2c08847ccb1cd6ebe11e1fd6b4f94c445ad9f10))

### Bug Fixes
* **preflight:** prevent floating promise and fix listener override args ([f4fe5be](https://github.com/D1g1talEntr0py/tsnode/commit/f4fe5bedfeb45ae377254aeb0e0dbcfc25b86b73))

### Bug Fixes
* **suppress-warnings:** tighten process.emit override typing ([70f4be2](https://github.com/D1g1talEntr0py/tsnode/commit/70f4be2d936ae637a48b0d37b30c67e04c16d808))






### Chores
* **deps:** bump pnpm and dependency versions ([22408a5](https://github.com/D1g1talEntr0py/tsnode/commit/22408a508d8c94949d5c20fc6fbf151bdef166a2))

### Chores
* **release:** 1.3.0 [skip ci] ([bfb62d7](https://github.com/D1g1talEntr0py/tsnode/commit/bfb62d786fa635cd73a11234592ce55102fd2f3f))


### Code Refactoring
* **eslint:** overhaul ESLint flat config ([0e5283b](https://github.com/D1g1talEntr0py/tsnode/commit/0e5283bc85dc9103d9544b8fc41d8dc81aa02ecf))

### Code Refactoring
* **hooks:** minor type safety and code quality improvements ([8fb81cb](https://github.com/D1g1talEntr0py/tsnode/commit/8fb81cbdc550625649b45cd4e067b073e1944d0a))

### Code Refactoring
* **hooks:** add JSDoc to hook utility functions ([b92e0c9](https://github.com/D1g1talEntr0py/tsnode/commit/b92e0c91457906da308e03e8a9f45ff7e057789a))

### Code Refactoring
* **transform:** replace formatEsbuildError with a type guard ([2181f2f](https://github.com/D1g1talEntr0py/tsnode/commit/2181f2f103702b5b4ed04633cb94fb74edf02788))

### Code Refactoring
* **cache:** add JSDoc and minor code quality fixes to FileCache ([86ee87c](https://github.com/D1g1talEntr0py/tsnode/commit/86ee87c2ea70365f4059f68cfb5f7c01db64cdf1))

### Code Refactoring
* add JSDoc and tighten empty-catch comments across codebase ([e5f54cf](https://github.com/D1g1talEntr0py/tsnode/commit/e5f54cf0ee4f2d9e4bdcc2f9a40c92764b9fc97b))






## [1.2.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.1.2...v1.2.0) - 2026-08-08



### Features
* **loader:** share scoped hooks across dynamic imports ([6881368](https://github.com/D1g1talEntr0py/tsnode/commit/6881368cd150e8c0dfe088e0431402bbf0f82833))

### Features
* **watch:** stabilize reruns and dependency watching ([b5173ba](https://github.com/D1g1talEntr0py/tsnode/commit/b5173ba24220b26e6002cd96421ba4cced9a43e6))


### Bug Fixes
* **deps:** upgrade runtime and lint dependency set ([966cddd](https://github.com/D1g1talEntr0py/tsnode/commit/966cddd7a8cf6824182bac90ccaecbb2e62c56a3))

### Bug Fixes
* **cli:** run eval in-process with transformed source ([92782bb](https://github.com/D1g1talEntr0py/tsnode/commit/92782bbf822ba0be8610a3941e946aa0e54b06bb))


### Performance Improvements
* **cache:** limit cache sweep parallelism ([e65529c](https://github.com/D1g1talEntr0py/tsnode/commit/e65529c6e2124f9cdfcd1d51ffcfd72ddecd7b27))

### Performance Improvements
* **bench:** isolate caches and report runner versions ([bad18c7](https://github.com/D1g1talEntr0py/tsnode/commit/bad18c731fa9d2267c480f4845317aeed6df819f))





### Chores
* remove trailing commas ([bde1725](https://github.com/D1g1talEntr0py/tsnode/commit/bde1725f6e41a2e94924de8e3b6296bb1f7c532e))

### Chores
* **release:** 1.2.0 [skip ci] ([dcbc0e5](https://github.com/D1g1talEntr0py/tsnode/commit/dcbc0e529a2ca61ba312dc48fcb3131fa90204f1))


### Code Refactoring
* **types:** remove checked-in generated declarations ([6b28322](https://github.com/D1g1talEntr0py/tsnode/commit/6b283229040c7c234eed0258fe5d0e62e78e2069))

### Code Refactoring
* **lint:** enforce trailing commas and safer build exits ([62e2b87](https://github.com/D1g1talEntr0py/tsnode/commit/62e2b871688914f5000e7cc4cd2266fa1d68d471))

### Code Refactoring
* **debug:** serialize debug values without util inspect ([9f7152c](https://github.com/D1g1talEntr0py/tsnode/commit/9f7152ce90fc64e8e35095469c7e5bd7420229a3))




### Continuous Integration
* updated broken eslint rule ([d40980b](https://github.com/D1g1talEntr0py/tsnode/commit/d40980bf293cd229b2d0edef71776d8b1f6d24e5))



## [1.1.2](https://github.com/D1g1talEntr0py/tsnode/compare/v1.1.1...v1.1.2) - 2026-08-01




### Bug Fixes
* add shebang to CLI output and set executable permissions ([502d85b](https://github.com/D1g1talEntr0py/tsnode/commit/502d85bbb75a335d1530f2120a19eec30f8bc29f))






### Chores
* **release:** 1.1.2 [skip ci] ([f9d55e5](https://github.com/D1g1talEntr0py/tsnode/commit/f9d55e586148b5af2a803e8313cef549419d3169))







## [1.1.1](https://github.com/D1g1talEntr0py/tsnode/compare/v1.1.0...v1.1.1) - 2026-08-01









### Chores
* enhance comparison benchmark implementation to include esmLoaderPath for tsx ([6c52a03](https://github.com/D1g1talEntr0py/tsnode/commit/6c52a035fbe41391d517c9ebe3210dd1e894429e))

### Chores
* **release:** 1.1.1 [skip ci] ([8cc9c2d](https://github.com/D1g1talEntr0py/tsnode/commit/8cc9c2d6140615429a7ef27e2970ca0042ab148a))


### Code Refactoring
* optimize IPC connection handling and improve performance by using synchronous file operations ([82d3727](https://github.com/D1g1talEntr0py/tsnode/commit/82d37271758c527bc7a0f2c258622d37eadb0b02))






## [1.1.0](https://github.com/D1g1talEntr0py/tsnode/compare/v1.0.1...v1.1.0) - 2026-08-01



### Features
* implement loader declaration builder and enhance CLI signal handling ([cd1470c](https://github.com/D1g1talEntr0py/tsnode/commit/cd1470cd83004b34ca6cf8598efa6dd68ebf1944))







### Chores
* add Copilot instructions and update dependencies in package.json and pnpm-lock.yaml ([f5a317a](https://github.com/D1g1talEntr0py/tsnode/commit/f5a317a0bb7af0a43c3f7b56945b62040d5231fd))

### Chores
* **release:** 1.1.0 [skip ci] ([cfda05a](https://github.com/D1g1talEntr0py/tsnode/commit/cfda05a5748c09665bf02a7b21aaadd1bb081eaa))







## [1.0.1](https://github.com/D1g1talEntr0py/tsnode/compare/v1.0.0...v1.0.1) - 2026-07-28




### Bug Fixes
* fix(deps): fixes CWE-22 - Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal')
The product uses external input to construct a pathname that is intended to identify a file or directory that is located underneath a restricted parent directory, but the product does not properly neutralize special elements within the pathname that can cause the pathname to resolve to a location that is outside of the restricted directory. ([c27f5a3](https://github.com/D1g1talEntr0py/tsnode/commit/c27f5a34c9d8f96e05c596eb7c0a55d274697443))






### Chores
* **release:** 1.0.1 [skip ci] ([0e03ec2](https://github.com/D1g1talEntr0py/tsnode/commit/0e03ec29fe9128e2216e86b270c518b753ca2c61))







## [1.0.0](https://github.com/D1g1talEntr0py/tsnode/compare/...v1.0.0) - 2026-07-28


### Breaking Changes
* replace with ESM-only fork of tsx ([28e0aab](https://github.com/D1g1talEntr0py/tsnode/commit/28e0aab7311b415e53a4dfe15b65c6e8c9bbfc01))

### Breaking Changes
* Add unit tests for hook resolution, node features, run execution, transform cache, and utilities ([6908ca0](https://github.com/D1g1talEntr0py/tsnode/commit/6908ca0986da812cff0aef9566915b0b5b0bb048))








### Chores
* initial commit ([037ff9f](https://github.com/D1g1talEntr0py/tsnode/commit/037ff9f477fec457707d514e7e42c29437162933))

### Chores
* **release:** 1.0.0 [skip ci] ([45dc68a](https://github.com/D1g1talEntr0py/tsnode/commit/45dc68a3b7d9681e265760e27c91798807f59d91))



### Tests
* update CLI integration tests to use TypeScript source with resolve hook ([c217f0d](https://github.com/D1g1talEntr0py/tsnode/commit/c217f0d461a95442ae5699872bf5a4576bee908f))



### Continuous Integration
* **release:** update the publish workflow ([70a783c](https://github.com/D1g1talEntr0py/tsnode/commit/70a783c56b49f7f55a8e73be4c7bde4547bc8d02))


