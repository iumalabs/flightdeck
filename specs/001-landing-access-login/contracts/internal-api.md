# Internal API Contract: Landing Site, Access Login & App-Shell Skeleton

Control-plane routes only (constitution Principle I) — no ingest/data-plane contract exists in this
module (spec FR-014). Per research.md §1, the Cloudflare Access application covers only `/login`;
every other route below is authenticated by FlightDeck's own `fd_session` cookie, not
`Cf-Access-Jwt-Assertion`.

## `GET /login`

The only route Cloudflare Access actually protects. Access injects `Cf-Access-Jwt-Assertion` for
this path only.

**Behavior**: Verifies the header per constitution Principle II step 1 (JWKS signature,
issuer=`TEAM_DOMAIN`, audience=`POLICY_AUD`). On success: calls `upsertUser` (research.md §2),
mints a signed `fd_session` JWT (`HttpOnly`, `Secure`, `SameSite=Lax`) containing `sub`/`email`/
`role`, and responds `302` to `/web-app/`. On any verification failure: responds `403`, no cookie
set, no redirect.

## `POST /logout`

Ends FlightDeck's own session (research.md §3) — not the underlying Cloudflare Access session.

**Behavior**: Overwrites the `fd_session` cookie with an expired one. No auth required to call it
(there is nothing sensitive to protect — the worst an unauthenticated caller can do is sign
someone else's browser out, which requires already controlling that browser). Always responds
`204`.

## `GET /api/internal/me`

Returns the caller's identity if authenticated; the SPA uses this to decide marketing-site vs.
app-shell rendering and to populate the user menu (spec FR-011).

**Auth**: Requires a valid `fd_session` cookie (constitution Principle II step 2) — verified
against `SESSION_SECRET`, fail-closed `403` on missing/invalid/expired/tampered token.

**Response `200`**:
```json
{
  "sub": "string",
  "email": "string",
  "role": "member"
}
```

**Response `403`**: Missing/invalid/expired/tampered `fd_session` cookie. Body: plain text
`Forbidden`, no further detail (constitution Principle II — no distinction between failure reasons
is exposed).

## `GET /api/internal/projects`

Returns the seeded demo project(s) for the app-shell's project switcher (spec Key Entities:
Project).

**Auth**: Same `fd_session` verification as `GET /api/internal/me` above.

**Response `200`**:
```json
{
  "projects": [
    { "id": "string", "name": "string" }
  ]
}
```

## Non-goals for this contract

- No other `POST`/`PUT`/`DELETE` routes exist in this module beyond `/login` and `/logout` — nothing
  else here mutates state beyond the auth-middleware's own user upsert, which is not itself a
  client-invokable endpoint.
- No ingest routes (`/api/{project_id}/envelope/`, `/store/`, `/minidump/`) — those are Module 2+
  and are explicitly out of scope (spec FR-014).
