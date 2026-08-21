# Phase 1 Data Model: Landing Site, Access Login & App-Shell Skeleton

## User

Represents a person who has authenticated via Cloudflare Access at least once. Matches the
constitution's Identity & Authorization Data Model section.

| Field | Type | Notes |
|---|---|---|
| `sub` | TEXT, PRIMARY KEY | Stable identifier from the Access JWT. Never derived from email. |
| `email` | TEXT, NOT NULL | Updated on every login (can change at the IdP). |
| `idp` | TEXT, NOT NULL | Identity provider name/label from Access enrichment, or a fallback value if enrichment isn't called in this module. |
| `role` | TEXT, NOT NULL, DEFAULT `'member'` | Application-level role, independent of Access group membership per constitution. No role beyond the default is assigned or consumed by this module — role-gated behavior is future scope. |
| `created_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | Set once, on first insert. |
| `last_seen_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | Updated on every successful authentication. |

**Validation rules**: `sub` and `email` MUST be non-empty strings extracted from a JWT that has
already passed signature/issuer/audience verification (Principle II) — this table is never written
to from an unverified request.

**State transitions**: none beyond insert (first login) → update (`email`, `last_seen_at` on every
subsequent login). No delete path in this module.

## Project

A minimal seed record so the app-shell's project switcher and Overview screen have something to
render. Not a real customer-managed entity yet (see research.md §7) — schema is intentionally
narrow and expected to gain real columns (DSN public key, retention settings, etc.) in Module 2.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | e.g. a UUID or short slug. |
| `name` | TEXT, NOT NULL | Display name shown in the project switcher. |
| `created_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | |

**Validation rules**: none beyond NOT NULL — this table is only ever written by the baseline
migration's seed insert in this module, never by application code.

**State transitions**: none in this module (no create/edit/delete UI or API exists yet).

## Explicitly not modeled in this module

- `audit_log` — deferred per the plan's Constitution Check (Principle X applies to admin mutations,
  none of which exist yet in this module).
- Any DSN/public-key, issue, trace, log, release, uptime-check, or feedback entity — all owned by
  later modules per the constitution's Product Scope & Module Roadmap.
