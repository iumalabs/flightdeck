# Changelog

## [0.13.4](https://github.com/iumalabs/flightdeck/compare/v0.13.3...v0.13.4) (2026-08-26)


### Bug Fixes

* **marketing:** catch remaining false claims missed in first pass ([21324a2](https://github.com/iumalabs/flightdeck/commit/21324a2646135d10c4b4728da7a4732bd2671e51))
* **marketing:** correct false capability claims on Product/Home pages ([bf38855](https://github.com/iumalabs/flightdeck/commit/bf38855320a2f6fdaf31f09d21db605b59fc132a))
* **marketing:** correct false capability claims on Product/Home pages ([59ba17e](https://github.com/iumalabs/flightdeck/commit/59ba17e52a173c35502b693fd524de4280527512))
* **marketing:** rename misleading 'Single-binary self-host' comparison row ([1c5a5ce](https://github.com/iumalabs/flightdeck/commit/1c5a5ce5fa5548aba04fc94a1dc0d0580f9866d1))
* **marketing:** rename misleading 'Single-binary self-host' comparison row ([3915fdb](https://github.com/iumalabs/flightdeck/commit/3915fdb53ca320853abb3357167fb3fbf38acd74))

## [0.13.3](https://github.com/iumalabs/flightdeck/compare/v0.13.2...v0.13.3) (2026-08-26)


### Bug Fixes

* **changelog:** add 0.13.2 entry that landed mid-task ([61ca2fd](https://github.com/iumalabs/flightdeck/commit/61ca2fd7d4d436b1a26e982e782ac847d81df4c0))
* **changelog:** catch up public changelog through 0.13.1, correct region claim ([35ea69c](https://github.com/iumalabs/flightdeck/commit/35ea69c1723b3aaa31b20e5c12e1ee51ccd65f46))
* **changelog:** catch up public changelog, correct region claim ([35b5a5e](https://github.com/iumalabs/flightdeck/commit/35b5a5eabb5f04ae0eafa2a296d4c748e0fdf6b8))

## [0.13.2](https://github.com/iumalabs/flightdeck/compare/v0.13.1...v0.13.2) (2026-08-26)


### Bug Fixes

* **marketing:** drop false 'manual merge and split' claim from Product page ([995e780](https://github.com/iumalabs/flightdeck/commit/995e780ccb2dd93ed680d788b6f4c74ab5d55dfc))
* **marketing:** drop false 'manual merge and split' claim from Product page ([b780c30](https://github.com/iumalabs/flightdeck/commit/b780c306936aec89fb33bb3f35bab9b32b00d664))
* **marketing:** remove fake Docker Compose / Kubernetes self-hosting paths ([4ec5b2f](https://github.com/iumalabs/flightdeck/commit/4ec5b2fd824832c9a039cad6d77c0436bbd74ca1))
* **marketing:** remove fake Docker Compose / Kubernetes self-hosting paths ([3f79a3c](https://github.com/iumalabs/flightdeck/commit/3f79a3cb51072503dbdbc11566e3fcff1658c919)), closes [#86](https://github.com/iumalabs/flightdeck/issues/86)
* **marketing:** rewrite Docs page to describe real, shipped behavior ([ddfeb71](https://github.com/iumalabs/flightdeck/commit/ddfeb719ae360748a1d40fc1f03fb638c281826d))
* **marketing:** rewrite Docs page to describe real, shipped behavior ([ac8de75](https://github.com/iumalabs/flightdeck/commit/ac8de75a8f5af79b509ac57d5e87b121ab0e68ca))
* remove duplicate T033 entry from tasks.md ([7f554e4](https://github.com/iumalabs/flightdeck/commit/7f554e44331259a1c34e323c7acd1e4afb98fcc4))
* **traces:** align waterfall-layout field names with real camelCase API contract ([80f2b8a](https://github.com/iumalabs/flightdeck/commit/80f2b8a7786ab177650b34db3b03629e9f585ad3))
* **traces:** align waterfall-layout field names with real camelCase API contract ([850eb51](https://github.com/iumalabs/flightdeck/commit/850eb519fbc481df2a11ecb2790254336d7737a5)), closes [#79](https://github.com/iumalabs/flightdeck/issues/79)
* **uptime:** enforce MIN_INTERVAL_SECONDS inside createCheck() ([1903c12](https://github.com/iumalabs/flightdeck/commit/1903c12ad4df791f500d0d55dbdd1fa34a3de7a4))
* **uptime:** enforce MIN_INTERVAL_SECONDS inside createCheck() ([fc97c50](https://github.com/iumalabs/flightdeck/commit/fc97c50170796217a621d621bf4a6e2c3b12aaef))

## [0.13.1](https://github.com/iumalabs/flightdeck/compare/v0.13.0...v0.13.1) (2026-08-25)


### Bug Fixes

* **uptime:** don't seed a fake Health check from an SPA catch-all 200 ([4138e35](https://github.com/iumalabs/flightdeck/commit/4138e3594c225422605f22a9fc73e41a360293bf))
* **uptime:** don't seed a fake Health check from an SPA catch-all 200 ([fc29cff](https://github.com/iumalabs/flightdeck/commit/fc29cffef45c898557d357a510983c609f2ffd83)), closes [#75](https://github.com/iumalabs/flightdeck/issues/75)

## [0.13.0](https://github.com/iumalabs/flightdeck/compare/v0.12.0...v0.13.0) (2026-08-25)


### Features

* **uptime:** seed default checks when a project's baseUrl is given ([b318202](https://github.com/iumalabs/flightdeck/commit/b318202f4fd61685dac5ef5083d96a9728c080e8)), closes [#72](https://github.com/iumalabs/flightdeck/issues/72)

## [0.12.0](https://github.com/iumalabs/flightdeck/compare/v0.11.2...v0.12.0) (2026-08-25)


### Features

* **db:** switch projects.id to a numeric INTEGER primary key ([53c28bb](https://github.com/iumalabs/flightdeck/commit/53c28bb0c0e6b43b089c4093229e171ce722e6f2))


### Bug Fixes

* **db:** switch projects.id to a numeric primary key for Sentry SDK DSN compatibility ([3587120](https://github.com/iumalabs/flightdeck/commit/358712033b7675de3420816b80d189c6e5ebd5bc))
* **ingest:** issue numeric project ids and validate the DSN path segment ([d158dca](https://github.com/iumalabs/flightdeck/commit/d158dcaeae61a52bbe7e7d440f6de65da7ccc83b))

## [0.11.2](https://github.com/iumalabs/flightdeck/compare/v0.11.1...v0.11.2) (2026-08-25)


### Bug Fixes

* **shell:** wrap Logs search toolbar instead of overflowing at narrow widths ([4e9ea51](https://github.com/iumalabs/flightdeck/commit/4e9ea51a24feef2c2e747db9ff394b2c81d30bbf))
* **shell:** wrap Logs search toolbar instead of overflowing at narrow widths ([ea7459a](https://github.com/iumalabs/flightdeck/commit/ea7459acc4a9f656dd258461504ea39293bb1c1e))

## [0.11.1](https://github.com/iumalabs/flightdeck/compare/v0.11.0...v0.11.1) (2026-08-25)


### Bug Fixes

* **app:** route by pathname prefix and sync app-shell screen with URL ([6714398](https://github.com/iumalabs/flightdeck/commit/6714398dd6791eac188930072985ee9aa79cd95b))
* **logs:** revoke previous R2 export token before re-provisioning ([da8e87e](https://github.com/iumalabs/flightdeck/commit/da8e87eee516c7ac88c60be46d39ea71cbd21b22))
* **logs:** revoke previous R2 export token before re-provisioning ([4c37882](https://github.com/iumalabs/flightdeck/commit/4c3788274a4a63ee24c4869db0094881e34c94e0))
* **uptime:** stop self-referential HTTP checks from false-positive 522ing ([38b855d](https://github.com/iumalabs/flightdeck/commit/38b855d307de0b7fc65e022d64f90eb1100b31dd))
* **uptime:** stop self-referential HTTP checks from false-positive 522ing ([cd9a913](https://github.com/iumalabs/flightdeck/commit/cd9a9136f4bb928acb82a2f8b7d015194ca42a62))

## [0.11.0](https://github.com/iumalabs/flightdeck/compare/v0.10.0...v0.11.0) (2026-08-24)


### Features

* **feedback:** prefill crash-report dialog name/email from GET query params (T030) ([e03ddd5](https://github.com/iumalabs/flightdeck/commit/e03ddd5a0d87f6c2c37579f796a5ac58e8869b49))
* **feedback:** prefill crash-report dialog name/email from GET query params (T030) ([234be85](https://github.com/iumalabs/flightdeck/commit/234be8518c180fb0efb875be2574470f847fe2ec))


### Bug Fixes

* **uptime:** wire runCheck() to applyOutcome(); fix Alerts empty state (T038, T039) ([a913366](https://github.com/iumalabs/flightdeck/commit/a913366e20d21447bb8cf07b24fefe741b0a85f5))
* **uptime:** wire runCheck() to decide.ts's applyOutcome(); fix Alerts empty state (T038, T039) ([9656e67](https://github.com/iumalabs/flightdeck/commit/9656e6791a9741deb1227f7ec3e7d7fa25259ec5))

## [0.10.0](https://github.com/iumalabs/flightdeck/compare/v0.9.2...v0.10.0) (2026-08-24)


### Features

* **releases:** add project-scoped release routes; window adoption to recent sessions ([9251a82](https://github.com/iumalabs/flightdeck/commit/9251a82528f60b8fac0a7ad32e8a5dbfff2acab0))


### Bug Fixes

* **feedback:** rate-limit and size-cap the crash-report dialog ([57c87bd](https://github.com/iumalabs/flightdeck/commit/57c87bdf00937bff08a1f86374c65dbc33dd12c3))
* **feedback:** rate-limit and size-cap the crash-report dialog endpoint ([54e102b](https://github.com/iumalabs/flightdeck/commit/54e102b02158021f97b47d6c11a05f85ae69614e))
* **ingest:** add submission-level de-duplication for log ingest (T044) ([7803a49](https://github.com/iumalabs/flightdeck/commit/7803a49f9f2ee6d9deae268e95e3278678552bba))
* **ingest:** add submission-level de-duplication for log ingest (T044) ([e49e628](https://github.com/iumalabs/flightdeck/commit/e49e628de597fe9c1aa83257a7ae4d39f0ba4f11))
* **ingest:** reject oversized transaction items before Queue send (T040) ([33fbbe4](https://github.com/iumalabs/flightdeck/commit/33fbbe4ae83ff9acb92fffb77e44e6ed54b03233))
* **issues:** distinguish retention-pruned event data from never-recorded (T050) ([ea00d4a](https://github.com/iumalabs/flightdeck/commit/ea00d4a31e7c4756383c120fefe74c4619ab57f7))
* **issues:** distinguish retention-pruned event data from never-recorded (T050) ([783ccbc](https://github.com/iumalabs/flightdeck/commit/783ccbcf362f9e232dbd8995fd866d5a682cfb65))

## [0.9.2](https://github.com/iumalabs/flightdeck/compare/v0.9.1...v0.9.2) (2026-08-24)


### Bug Fixes

* **marketing:** sync Docs and Changelog with what actually shipped ([7169d9d](https://github.com/iumalabs/flightdeck/commit/7169d9d1a852975b6ac61682a913fa7ae2beb3bc))
* **marketing:** sync Docs and Changelog with what actually shipped ([9877580](https://github.com/iumalabs/flightdeck/commit/98775801187445a574902f350a70d044dcd9976b))

## [0.9.1](https://github.com/iumalabs/flightdeck/compare/v0.9.0...v0.9.1) (2026-08-23)


### Bug Fixes

* **ingest:** accept trailing-slash envelope path ([97a080f](https://github.com/iumalabs/flightdeck/commit/97a080f48c81c47c9739c01e98965226963d8234))
* **ingest:** accept trailing-slash envelope path ([f008de5](https://github.com/iumalabs/flightdeck/commit/f008de528c893aa54e2c5eeadce3d5496ce678b3))

## [0.9.0](https://github.com/iumalabs/flightdeck/compare/v0.8.0...v0.9.0) (2026-08-23)


### Features

* **api:** version FlightDeck's own control-plane API as /api/internal/v1 ([702a834](https://github.com/iumalabs/flightdeck/commit/702a834b8d93066e5f3ad67d066270fb959b7e8e))
* **api:** version FlightDeck's own control-plane API as /api/internal/v1 ([2650283](https://github.com/iumalabs/flightdeck/commit/265028314b2fb278c3ba32ac2ae6a7f08aebd487))


### Bug Fixes

* **dashboard:** replace native &lt;select&gt; popups with themed dropdowns ([4b992c7](https://github.com/iumalabs/flightdeck/commit/4b992c7fb2470e3868f839cbac52f7fb597e0be4))
* **dashboard:** replace native &lt;select&gt; popups with themed dropdowns ([5f9e79a](https://github.com/iumalabs/flightdeck/commit/5f9e79a84fe85b4c7f8a1d1762d8f2204b375432))

## [0.8.0](https://github.com/iumalabs/flightdeck/compare/v0.7.1...v0.8.0) (2026-08-23)


### Features

* add GET /api/version to confirm which environment is live ([57dcada](https://github.com/iumalabs/flightdeck/commit/57dcada06dfd9b4757a2b2e2236571e36ab81cbd))
* add GET /api/version to confirm which environment is live ([4e3f695](https://github.com/iumalabs/flightdeck/commit/4e3f695cf3c5f142cfd35e87c6c191d6d21d921c))

## [0.7.1](https://github.com/iumalabs/flightdeck/compare/v0.7.0...v0.7.1) (2026-08-23)


### Bug Fixes

* **deploy:** isolate preview deploys onto their own Worker script ([8c13429](https://github.com/iumalabs/flightdeck/commit/8c13429c9a97b4ec6280483ad144f7547219d372))
* **deploy:** isolate preview deploys onto their own Worker script ([7c41cf9](https://github.com/iumalabs/flightdeck/commit/7c41cf9fdf85bccee23796f118aca1f75adb8f2d))

## [0.7.0](https://github.com/iumalabs/flightdeck/compare/v0.6.0...v0.7.0) (2026-08-23)


### Features

* add favicon and sidebar app version label ([78151d5](https://github.com/iumalabs/flightdeck/commit/78151d5fca07c52822b26b4df2f0dddddc6faddc))
* **dashboard:** surface each project's real DSN on Install SDK ([07d0ac5](https://github.com/iumalabs/flightdeck/commit/07d0ac5d39b7aa52dee427e969f799c6634cb6c7))
* **dashboard:** wire Overview to real per-pillar counts ([8e4650d](https://github.com/iumalabs/flightdeck/commit/8e4650d1d491aab4a1c1ece2cbb3ff1e46b0f4cf))


### Bug Fixes

* close [#23](https://github.com/iumalabs/flightdeck/issues/23)/[#24](https://github.com/iumalabs/flightdeck/issues/24)/[#25](https://github.com/iumalabs/flightdeck/issues/25), add [#29](https://github.com/iumalabs/flightdeck/issues/29) fix (Overview real data) ([ec1e6f6](https://github.com/iumalabs/flightdeck/commit/ec1e6f6e56a36f4c2dc1b83b9abfc1bb360d9f2e))
* **worker:** log unhandled route errors instead of silently 500ing ([39d6a2a](https://github.com/iumalabs/flightdeck/commit/39d6a2a0aece9f202f3040c1d4a21470737fb6f7))

## [0.6.0](https://github.com/iumalabs/flightdeck/compare/v0.5.0...v0.6.0) (2026-08-23)


### Features

* retroactively mark multi-project support as released (fixes [#26](https://github.com/iumalabs/flightdeck/issues/26) commit-convention miss) ([4d88fb7](https://github.com/iumalabs/flightdeck/commit/4d88fb7aa0064b678f987e942eec32e5c5a789c5))


### Bug Fixes

* retroactively mark multi-project support as released ([d7bda50](https://github.com/iumalabs/flightdeck/commit/d7bda50b5cf71eded81df13c50cba0fe1ee3f506))

## [0.5.0](https://github.com/iumalabs/flightdeck/compare/v0.4.0...v0.5.0) (2026-08-23)


### Features

* **feedback:** add dashboard routes, Feedback list/detail, and issue cross-linking ([ec31314](https://github.com/iumalabs/flightdeck/commit/ec313148cdba85b3723e06f96f88942845b08d59))
* **feedback:** add feedback schema, envelope widget path, and crash-report dialog ([d1c84f1](https://github.com/iumalabs/flightdeck/commit/d1c84f1aeb2a69f1101dd61b939388d5cdb94e76))
* **logs:** add Logs screen (live tail + search) and export UI ([0012ba1](https://github.com/iumalabs/flightdeck/commit/0012ba1685e5c735e3fa9e9ba8babd3daee67855))
* **logs:** add Queue/DO/R2 bindings and log_batches schema ([b72b76c](https://github.com/iumalabs/flightdeck/commit/b72b76c09e2e528b0a0b392bb61320cdfb6f8e0d))
* **logs:** add search, live-tail upgrade, and S3 export endpoints ([3cfea7a](https://github.com/iumalabs/flightdeck/commit/3cfea7a8f23f3e96f9cf30642d0149668279bffd))
* **logs:** ingest structured logs via Queue and stream them live ([5eb1970](https://github.com/iumalabs/flightdeck/commit/5eb19706dfe659e1c2103cd1b86de3438f6cd454))
* **releases:** add API token auth and releases schema ([85aed2a](https://github.com/iumalabs/flightdeck/commit/85aed2a4b20bad34801afde581166df5743f2e27))
* **releases:** add Releases screens and issue-resolve UI ([61c8ba7](https://github.com/iumalabs/flightdeck/commit/61c8ba7cdc5d74810369b2acb7ce81a0563eac64))
* **releases:** add sentry-cli-compatible and dashboard release APIs ([980e9ba](https://github.com/iumalabs/flightdeck/commit/980e9ba2866e590bf01554a2ba397253fc71a2e0))
* **releases:** ingest session data and detect regressions ([81f1118](https://github.com/iumalabs/flightdeck/commit/81f11189a1652c106de2b5bc914bdc20896a6481))
* **uptime:** add check CRUD, manual trigger, and incidents API ([eb6f8c4](https://github.com/iumalabs/flightdeck/commit/eb6f8c4834f81028ff191d1f2bad0ac40b53e65f))
* **uptime:** add checks schema, cron scheduling, and shared runCheck evaluation ([6629ba9](https://github.com/iumalabs/flightdeck/commit/6629ba9261c230c8eab2d85cdf4cb3991dd0e59e))
* **uptime:** add Uptime, CheckDetail, and Alerts screens ([c7db159](https://github.com/iumalabs/flightdeck/commit/c7db1594b2b1023691b3aa3e84b5a0b530a0a185))

## [0.4.0](https://github.com/iumalabs/flightdeck/compare/v0.3.0...v0.4.0) (2026-08-22)


### Features

* **traces:** add internal traces API and trace-to-error linkage ([938c709](https://github.com/iumalabs/flightdeck/commit/938c709fd5175f24576d67e8f7c48f5ca6ea9e47))
* **traces:** add Queue binding and transactions schema ([21005ad](https://github.com/iumalabs/flightdeck/commit/21005ad8229651d3468e080ea8321458dae33d6f))
* **traces:** add Traces list and waterfall UI ([61bd726](https://github.com/iumalabs/flightdeck/commit/61bd7263f89e2f318ed19c78bfcfd623ff3c9456))
* **traces:** ingest transactions asynchronously via Queue ([7b55703](https://github.com/iumalabs/flightdeck/commit/7b55703f560fac0fc3f78e61d838df7f8dd37d48))

## [0.3.0](https://github.com/iumalabs/flightdeck/compare/v0.2.2...v0.3.0) (2026-08-21)


### Features

* GitHub App suspect-commit lookup (Module 2 US4) ([3bba6a5](https://github.com/iumalabs/flightdeck/commit/3bba6a5d45bdf2cb58b88e83137e63a33c9f6fab))
* ingest pipeline and issue list/detail (Module 2 US1+US2) ([074fe01](https://github.com/iumalabs/flightdeck/commit/074fe0111d8edecb4242c2f3eb59171673588cc1))
* Module 2 foundational scaffold (bindings, migration, routing split) ([2dffaa8](https://github.com/iumalabs/flightdeck/commit/2dffaa802aea615d0596358e1cbb21625d46a4d7))
* retention job, e2e coverage, and docs (Module 2 Polish) ([679fbc8](https://github.com/iumalabs/flightdeck/commit/679fbc84d8849d31aff8977b417fc7d60f1a711e))
* source map resolution and upload (Module 2 US3) ([3bb3249](https://github.com/iumalabs/flightdeck/commit/3bb3249918ccc19c2b62ed2ef181161fcfa8b542))


### Bug Fixes

* run deno fmt on README.md; gitignore *.pem ([a258b62](https://github.com/iumalabs/flightdeck/commit/a258b62b208e868afb1e3878c6b42eb3fcd18ccf))
* use a plain deploy for preview, not versioned upload ([56b28d1](https://github.com/iumalabs/flightdeck/commit/56b28d1c6ecdd7db7982e288ae146a90be681580))

## [0.2.2](https://github.com/iumalabs/flightdeck/compare/v0.2.1...v0.2.2) (2026-08-21)


### Bug Fixes

* automate D1 migrations against remote databases in CI ([f9b54bc](https://github.com/iumalabs/flightdeck/commit/f9b54bc65dbf04d4254f81fa4430fda96dfc1ffa))
* automate D1 migrations against remote databases in CI ([98df60c](https://github.com/iumalabs/flightdeck/commit/98df60cdeacd02c7ee81fbd5d4b948514034758a))

## [0.2.1](https://github.com/iumalabs/flightdeck/compare/v0.2.0...v0.2.1) (2026-08-21)


### Bug Fixes

* route /login through the Worker before static-asset SPA fallback ([f2c96ce](https://github.com/iumalabs/flightdeck/commit/f2c96ce2e9b6d5d75d02b94bc26708497d97ed1e))
* route /login, /logout, /api/* through the Worker before assets ([f6c4c96](https://github.com/iumalabs/flightdeck/commit/f6c4c96e8d6fba77635a295aba57c0bcfd637b33))

## [0.2.0](https://github.com/iumalabs/flightdeck/compare/v0.1.0...v0.2.0) (2026-08-21)


### Features

* bootstrap FlightDeck worker/app scaffold and marketing site ([7f8d017](https://github.com/iumalabs/flightdeck/commit/7f8d017554b1a2c2d49c31e234f7ed2adf10f25d))
* full app-shell navigation, empty states, and sign-out ([b865918](https://github.com/iumalabs/flightdeck/commit/b86591863e487f809d91685e9cc99fb3e2ceec71))
* real Cloudflare Access login via /login bounce + fd_session ([1ecc6a8](https://github.com/iumalabs/flightdeck/commit/1ecc6a81c88aca6253fea7eac26a5ef48f6b6bfc))


### Bug Fixes

* rename deploy task to deploy:production for Workers Builds ([be8b09c](https://github.com/iumalabs/flightdeck/commit/be8b09c57f332ebf2c1d9aa40b1c364c2d347e45))
