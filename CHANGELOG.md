# Changelog

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
