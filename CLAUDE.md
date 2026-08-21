# FlightDeck — Agent Guide

A Sentry-protocol-compatible observability platform. Runs as a single Cloudflare Worker.

## Read this first

**`.specify/memory/constitution.md` is authoritative.** Read it before planning or implementing
anything. This file only points outward — it does not restate what's there.

## Spec Kit workflow

Specs live under `specs/<NNN-feature-name>/` (created by `/speckit-specify`). Each feature moves
through, in order:

1. `/speckit-constitution` — amend project principles (rare; governance-level)
2. `/speckit-specify` — turn a feature description into `spec.md`
3. `/speckit-clarify` — optional, resolves ambiguity in `spec.md` before planning
4. `/speckit-plan` — turn `spec.md` into a design plan (`plan.md`), gated by a Constitution Check
   against every principle
5. `/speckit-tasks` — turn the plan into ordered, actionable `tasks.md`
6. `/speckit-analyze` — optional, cross-checks spec/plan/tasks for consistency
7. `/speckit-implement` — execute `tasks.md`
8. `/speckit-converge` — reconcile the codebase against spec/plan/tasks and append any remaining
   work as new tasks

Module 1 (landing site, Access login, app-shell skeleton) is in progress — see
[`specs/001-landing-access-login/`](specs/001-landing-access-login/). The constitution's Product
Scope & Module Roadmap section lists the full intended module surface beyond it.

When `/speckit-taskstoissues` converts `tasks.md` tasks into GitHub issues, title them
`FD-001: <description>` (not the skill's own default `T001: <description>`) — `FD-` (FlightDeck)
makes the ID identifiable out of context (commit messages, cross-repo references), not just within
this one repo's `tasks.md`. Task IDs inside `tasks.md` itself (`T001`, `T002`, ...) stay in the
standard Spec Kit format — only the GitHub issue title gets the `FD-` prefix.

## Definition of done

A feature is done when: it complies with every constitution principle, has tests written
before/alongside the implementation, has Playwright coverage if it's a user-facing flow, and passes
`deno fmt` / `deno lint` / `deno test`.

## Hard constraints — easiest to violate by accident

- **No `package.json`, ever.** Deno is the only local toolchain (`deno fmt`, `deno lint`,
  `deno test`, `deno coverage`, `deno task`). npm packages are fine via Deno's `npm:` specifier in
  `deno.json`'s import map — npm as a package manager is not.
- **One `deno.json`.** No separate `tsconfig.json`, `.eslintrc`, `.prettierrc`. If a tool wants to
  generate one of those, stop and surface it — don't let it happen silently.
- **`wrangler.jsonc` must have `"workers_dev": false`.** Non-negotiable, from the first commit
  onward. Never relax this for convenience or debugging.
- **Two trust surfaces, never conflated.** The dashboard and `/api/internal/*` sit behind Cloudflare
  Access; ingest endpoints (once they exist, Module 2+) are public and authenticated by DSN key
  instead. Never implement IdP flows — no OAuth client code, no `passport` adapters, no password
  storage. See constitution Principles I–III before touching anything auth-related.
- **Sentry protocol compatibility is a hard external contract** once ingest exists (Module 2+) — see
  constitution Principle IV before changing any envelope/store/minidump/DSN-shaped code.
