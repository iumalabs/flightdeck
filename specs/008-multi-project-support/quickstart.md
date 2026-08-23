# Quickstart: Multi-Project Support

## Prerequisites

- Modules 1-7 running locally (no new migration, no new binding).
- A valid local test session cookie (established pattern from every prior module's quickstart).

## Validate User Story 1 — create a project, get a working, isolated DSN

```sh
curl -X POST http://127.0.0.1:8787/api/internal/projects \
  -H "Cookie: fd_session=<local test session>" -H "Content-Type: application/json" \
  -d '{"name":"typestreak"}'
```

Confirm `201` with `{ id, name, dsn }`. Ingest a test event using the returned `dsn`'s embedded key:

```sh
curl -X POST "http://127.0.0.1:8787/api/{returned-id}/envelope?sentry_key={returned-key}" \
  --data-binary $'{"event_id":"<uuid>"}\n{"type":"event"}\n{"event_id":"<uuid>","level":"error","exception":{"values":[{"type":"QuickstartTest"}]}}\n'
```

Confirm `GET /api/internal/issues?project={returned-id}` shows it, and
`GET /api/internal/issues?project=demo` does NOT (contracts/projects-internal-api.md's isolation
guarantee).

## Validate User Story 2 — switching scopes every dashboard screen

With two projects each holding distinct issues, log into the dashboard, use the project switcher in
the sidebar, and confirm Issues/Traces/Logs/Releases/Uptime/Feedback all show only the selected
project's data after switching — not the other project's, not both mixed together.

## Validate User Story 3 — DSN visible immediately on creation

Through the dashboard's Settings screen, submit the project-creation form and confirm the DSN
renders inline in the same view, with no separate navigation step required to find it.

## Automated test commands

```sh
deno task test              # unit: resolveRequestedProject()'s 3 cases
deno task test:contract     # contract tests against a real wrangler dev
deno task test:e2e           # multi-project switching UI flow
```
