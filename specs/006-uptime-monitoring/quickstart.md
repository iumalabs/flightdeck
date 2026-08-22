# Quickstart: Uptime Monitoring

## Prerequisites

- Module 1/2 running locally (this module needs only the identity/session model, no ingest
  infrastructure).
- This module's migration applied locally: `deno task db:migrations:apply:local` (re-run after
  `0006_uptime_monitoring.sql` is added).

## Validate User Story 1 — checks run and report status

```sh
curl -X POST http://127.0.0.1:8787/api/internal/checks \
  -H "Cookie: fd_session=<local test session>" -H "Content-Type: application/json" \
  -d '{"name":"demo http","type":"http","target":"https://example.com","intervalSeconds":60}'
```

Wait for the local `wrangler dev` process's cron simulation to fire (or trigger manually per User
Story 3 below, which is the more practical way to validate this locally without waiting for real
time to pass). Confirm `GET /api/internal/checks/{id}` shows `status: "up"` and a recorded
`check_runs` entry. Repeat with an unreachable target (`https://127.0.0.1:1`, an unbound local
port) and confirm `status: "down"`.

## Validate User Story 2 — incident-aware alerting

Configure a check with `failureThreshold: 2` against an unreachable target. Trigger it manually
(User Story 3) twice — confirm `GET /api/internal/incidents` shows exactly one open incident after
the second failure, and that a third manual trigger (still failing) does NOT create a second
incident. Then point the check at a reachable target and trigger it `recoveryThreshold` times —
confirm the incident's `resolvedAt` is set.

## Validate User Story 3 — manual trigger uses the same evaluation

```sh
curl -X POST http://127.0.0.1:8787/api/internal/checks/{id}/trigger \
  -H "Cookie: fd_session=<local test session>"
```

Confirm the response reflects the real, immediate result of running the check right now, and that
it correctly updates `consecutive_failures`/`consecutive_successes`/`status` exactly as a scheduled
run reaching the same state would (contracts/uptime-internal-api.md's `incidentOpened`/
`incidentResolved` fields make this directly observable).

## Validate User Story 4 — webhook delivery

Configure a check with `webhookUrl` pointing at a local request-capturing endpoint (e.g.
`https://webhook.site/...` or a throwaway local listener). Trigger an incident open and resolution
per User Story 2's steps, and confirm the webhook endpoint receives exactly one request for each,
with a payload describing the incident.

## Automated test commands

```sh
deno task test              # unit: uptime-evaluate (pure decision logic), uptime-shared-path
deno task test:contract     # contract tests against a real wrangler dev
deno task test:e2e           # Uptime/Alerts UI flow
```
