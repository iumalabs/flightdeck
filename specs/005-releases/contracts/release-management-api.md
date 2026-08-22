# Release Management API Contract: Releases (sentry-cli-compatible)

Authenticated by project-scoped API token (`Authorization: Bearer <token>`), NOT by session cookie
or DSN key (research.md §4) — a control-plane mechanism in bearer-token form, for non-browser CI/CD
clients. Path shapes match real `sentry-cli`/Sentry API exactly (research.md §1); `{org_slug}` is
accepted but never validated (research.md §3).

## `POST /api/0/organizations/{org_slug}/releases/`

Creates a release. `sentry-cli releases new <version>`.

**Request**: `{ "version": "string", "projects": ["string"], "ref": "string?", "url": "string?", "dateReleased": "string?" }`.
`{org_slug}` is ignored; `projects` (slugs, matching FlightDeck's project `id`) is how the release
is actually associated.

**Behavior**: creates the release for each named project (`UNIQUE(project_id, version)` — a repeat
call for an already-existing version is a no-op, spec FR-004). Writes `audit_log` (constitution
Principle X, actor = token's owning account).

**Response `201`**: the created (or existing, if idempotent no-op) release's fields, matching
Sentry's own release-object shape closely enough for `sentry-cli`'s own response parsing to
succeed. **Response `403`**: invalid/revoked token, or a project slug the token isn't scoped to.

## `POST /api/0/projects/{org_slug}/{project_slug}/releases/{version}/files/`

Uploads a source map. `sentry-cli releases files <version> upload-sourcemaps <path>`.

**Request**: `multipart/form-data` — `file`, optional `name`/`dist`/`header`.

**Behavior**: writes into the SAME `source_maps`/`releases` tables Module 2's dashboard-facing
upload endpoint (`worker/modules/projects/routes.ts`) already writes into — this is an additive
second front door, not a replacement (research.md's design note). Implicitly creates the release if
it doesn't exist yet, matching Module 2's own upload endpoint's existing behavior.

**Response `201`**: `{ "id": "string" }`. **Response `413`**: file exceeds the configured maximum
size (reusing Module 2's existing limit).

## `PUT`-equivalent finalize endpoint (path per implementation, matching `sentry-cli releases finalize`'s real target)

Sets `date_released` on an existing release.

**Behavior**: idempotent — finalizing an already-finalized release just updates `date_released`
again, not an error.

## `set-commits` endpoint (path per implementation, matching `sentry-cli releases set-commits`'s real target)

Associates a range of commits with a release, sourced from the project's connected GitHub repository
(Module 2's existing `worker/modules/github/app-auth.ts` infrastructure — no new GitHub credential
mechanism).

**Behavior**: writes one `release_commits` row per commit in the specified range. **Response**:
`404`-equivalent behavior (not a hard error) when no repository is connected for the project —
matching Module 2's established "absent, not broken" pattern for optional GitHub integration.

## `POST .../deploys/` (`deploys new --release <v> -e <env>`)

Records a deploy of a release to an environment.

**Request**: `{ "environment": "string", "dateFinished": "string?" }`.

**Response `201`**: `{ "id": "string" }`.

## `GET`/`DELETE` release list/retrieve/delete (`releases list` / `delete` / `propose-version`)

Both org- and project-scoped path variants, per research.md §1's confirmed coverage — standard
list/retrieve/delete semantics, `audit_log`-recorded for the mutating (delete) case.

## Non-goals for this contract

- No organizations feature — `{org_slug}` is accepted, never validated, never used to scope
  anything beyond what the request body's own `projects`/path's `project_slug` already specifies.
- No OAuth-style token refresh/rotation flow — tokens are generated, used until revoked, and
  revoked; no expiry/refresh mechanism in this module's scope.
