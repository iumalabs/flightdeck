# Internal API Contract: Landing Site, Access Login & App-Shell Skeleton

Control-plane routes only (constitution Principle I) — no ingest/data-plane contract exists in this
module (spec FR-014).

## `GET /api/internal/me`

Returns the caller's identity if authenticated; the SPA uses this to decide marketing-site vs.
app-shell rendering and to populate the user menu (spec FR-011).

**Auth**: Requires a valid `Cf-Access-Jwt-Assertion` header (constitution Principle II). On success,
the request has already passed through `accessAuth` middleware, which performs the first-login
upsert (research.md §2) before this handler runs.

**Response `200`**:
```json
{
  "sub": "string",
  "email": "string",
  "role": "member"
}
```

**Response `403`**: Missing/invalid/expired Access JWT, or issuer/audience mismatch. Body: plain
text `Forbidden`, no further detail (constitution Principle II — no distinction between failure
reasons is exposed).

## `GET /api/internal/projects`

Returns the seeded demo project(s) for the app-shell's project switcher (spec Key Entities:
Project).

**Auth**: Same as above — behind `accessAuth`.

**Response `200`**:
```json
{
  "projects": [
    { "id": "string", "name": "string" }
  ]
}
```

## Non-goals for this contract

- No `POST`/`PUT`/`DELETE` routes exist in this module — nothing here mutates state beyond the
  auth-middleware's own user upsert, which is not itself a client-invokable endpoint.
- No ingest routes (`/api/{project_id}/envelope/`, `/store/`, `/minidump/`) — those are Module 2+
  and are explicitly out of scope (spec FR-014).
- No sign-out endpoint — sign-out is client-side session-state clearing only (research.md §3), not a
  server call.
