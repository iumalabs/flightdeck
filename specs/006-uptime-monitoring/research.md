# Research: Uptime Monitoring

Consolidates platform-capability research (Cloudflare's actual execution-region controls, native
Health Checks/Load Balancing, `cloudflare:sockets`, Cron Trigger limits — researched against
developers.cloudflare.com) and FlareTower's confirmed shared-evaluation-logic precedent, plus the
scope decisions made from them. This module has markedly less Sentry-protocol grounding than Modules
2-5 — noted explicitly throughout rather than manufactured.

## 1. Multi-region: a documented, deliberate deviation from the constitution's literal wording

**Decision (confirmed with the user before this spec was written)**: Module 6 ships single-region
for MVP — checks run via Cloudflare's standard `scheduled()` mechanism, executing at whichever colo
Cloudflare's real-time load-balancing selects, never a developer-chosen or FlightDeck-exposed named
region. This is NOT the "multi-region HTTP/TCP checks" the constitution's Module 6 roadmap line
names.

**Rationale — investigated thoroughly, not assumed**: Cloudflare Cron Triggers have no documented
API to pin, choose, or fan out a single scheduled invocation across deliberately different
geographic regions — confirmed directly from Cloudflare's own blog ("a job scheduled from San
Francisco... might be sent to Paris because it's 4am there and traffic across Europe is low").
Cloudflare's own native Health Checks (0 checks on Free, 10-check minimum on Pro) and Load Balancing
health checks (paid add-on; true multi-region geo-steering further gated behind Business/Enterprise)
are both the wrong SHAPE (they monitor an origin already on Cloudflare's network as part of a zone,
not an arbitrary third-party URL a FlightDeck customer supplies) and the wrong TIER (conflict with
the free-tier/self-hostable posture every prior module protected). Genuine multi-region comparison
would require either a paid Cloudflare product this project has consistently declined (Module 4
declined Pipelines for the same reason) or external third-party check infrastructure (a materially
different, larger architecture this module's scope doesn't cover). Shipping single-region and
labeling it honestly is the only option that doesn't silently misrepresent what the feature actually
does.

**This is this session's first real, load-bearing Complexity Tracking entry** (see plan.md) — every
prior module found a path to full constitution-literal compliance; this one genuinely can't without
a worse tradeoff, and that's recorded explicitly, not glossed over. Multi-region is named future
work in spec.md's Assumptions, not silently dropped.

**Source**: https://blog.cloudflare.com/introducing-cron-triggers-for-cloudflare-workers/,
https://developers.cloudflare.com/workers/configuration/cron-triggers/,
https://developers.cloudflare.com/health-checks/,
https://developers.cloudflare.com/load-balancing/troubleshooting/load-balancing-faq/

## 2. TCP checks: `cloudflare:sockets`' `connect()` API, confirmed shape

**Decision**: TCP checks use the Workers runtime's built-in socket API directly — no npm dependency:

```ts
import { connect } from "cloudflare:sockets";

const socket = connect({ hostname, port });
try {
  await socket.opened; // resolves on connect, rejects on failure
  socket.close();
  // success
} catch {
  // failure
}
```

**Constraints confirmed**: connections to Cloudflare's own IP ranges and port 25 are blocked; socket
creation must happen within a request/handler context, not global scope (consistent with
`runCheck()` being invoked per check-run, never at module load time); open-socket count contributes
to a per-Worker concurrent-connection limit (not a concern at this module's realistic check volume).

**Source**: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/

## 3. Scheduling: a 1-minute cron, the finest granularity cron syntax supports

**Decision**: a new cron entry, `* * * * *` (every minute), added to the existing `triggers.crons`
array (already used by Module 2's retention job) — `worker/index.ts`'s `scheduled()` handler gains a
case that queries `checks` for rows whose `next_run_at` has passed, runs each due check via the
shared `runCheck()` function, and sets `next_run_at = now + interval_seconds`.

**Rationale**: standard cron syntax has minute-level granularity — there is no sub-minute cron
expression, so every-minute IS the finest schedule resolution available, not an arbitrary choice
among finer options. This bounds scheduling drift to under a minute for any check regardless of its
own configured interval. Cloudflare's account-wide Cron Trigger limit (5 on Free, 250 on Paid) is
confirmed to comfortably accommodate this — Module 2's retention job already uses one slot, this
module's uptime cron uses a second, both well within the Free-tier ceiling of 5.

**Source**: https://developers.cloudflare.com/workers/configuration/cron-triggers/,
https://developers.cloudflare.com/workers/platform/limits/ (5 Cron Triggers/account on Free)

## 4. Minimum interval and per-project check limits: real abuse-prevention reasoning

**Decision**: a 60-second minimum `interval_seconds` (matching the 1-minute cron's own resolution —
nothing finer would ever actually fire more often anyway), and a maximum of 20 checks per project.

**Rationale**: FlightDeck becomes an outbound requester against arbitrary third-party targets it
doesn't control once this module ships — a categorically different abuse-potential shape than Module
2's DSN-authenticated customer-data ingest (where FlightDeck is the recipient of traffic, not the
originator of it against someone else's infrastructure). A 60-second floor prevents configuring a
check that would try to fire more often than the scheduling mechanism could even honor, and a
per-project cap (20 checks) bounds the maximum sustained outbound request rate one project can
generate through FlightDeck's own infrastructure (at the floor interval, 20 checks/project is at
most ~20 requests/minute from that project, a modest, reasonable ceiling for legitimate use that
still meaningfully bounds worst-case abuse).

## 5. Data model volume/retention: `check_runs` gets a bounded window, `incidents` does not

**Decision**: `check_runs` (one row per check execution) gets its own retention window — 30 days —
pruned by extending the existing retention job (`worker/modules/ingest/retention.ts`, already
pruning Module 2's `events` and, per Modules 3-4's plans, `transactions`/`log_batches`). `incidents`
and `checks` themselves are NOT pruned — they're low-volume (one row per outage, one row per
configured check) summary/configuration data, not raw high-frequency telemetry.

**Rationale, reasoned from actual volume**: at the 60-second floor with the 20-checks-per-project
cap, one project's `check_runs` writes could reach ~28,800 rows/day at the theoretical maximum —
comfortably within D1's 100k-row-writes/day free tier for a single project, but genuinely
high-frequency, append-only data with the same shape (if not the same scale) as Modules 3-4's volume
concerns, so it gets the same treatment: a bounded window, not indefinite retention. Spec.md's
"uptime percentage over a recent window" (FR-004) doesn't need history older than a month anyway.

## 6. Check deletion: open incidents auto-resolve, never left dangling

**Decision**: deleting a check auto-resolves any of its open incidents (`resolved_at = now()`) as
part of the same delete operation, rather than leaving them open with no owning check to reference,
or blocking the delete until incidents are manually resolved first.

**Rationale**: spec.md's Edge Cases explicitly requires this not be left dangling. Auto-resolving
(rather than blocking deletion) keeps the delete action simple and matches how a developer would
reasonably expect "delete this check" to behave — they're saying "stop monitoring this," which
implicitly means "and stop tracking its incident state too," not "refuse until I manually close out
every incident first."

## 7. Webhook delivery: single attempt, no retry — a deliberate, justified MVP scope

**Decision**: webhook delivery on incident open/resolve is a single `fetch()` POST with a short
timeout (e.g. 5s), fire-and-forget — no retry on failure, no queue.

**Rationale**: spec.md's FR-011 requires that webhook delivery failure MUST NOT block or corrupt the
core incident record — the only way to guarantee that unconditionally is for webhook delivery to be
genuinely decoupled from (not a precondition for) the incident state transition it's reporting on.
Adding even one retry would require either delaying `runCheck()`'s completion (bad — a slow or
unreachable webhook target shouldn't make check evaluation itself slower) or introducing a Queue for
a feature explicitly scoped as "optional, best-effort" (real complexity for a User-Story-4,
lowest-priority feature) — not justified at this module's scope. If reliable webhook delivery
becomes a real need later, that's a natural, self-contained future enhancement, not a gap this
module's design silently created.

## 8. Constitution Principle V compliance: proof by construction, not assertion

**Decision**: `worker/modules/uptime/evaluate.ts` exports exactly one function,
`runCheck(env, checkId, trigger)`, that both the `scheduled()` handler's uptime cron case and the
new interactive "test this check now" API route call directly — mirroring FlareTower's confirmed
`runEvaluation(env, trigger)` pattern (`worker/modules/workers-access-exposure/routes.ts`,
`trigger: "scheduled"` from `scheduled()`, `trigger: "interactive"` from a dashboard route) exactly,
not a superficially-similar-but-separate implementation per call site.

**Testing this is load-bearing, not incidental**: a unit/integration test asserts BOTH call sites
invoke the same exported function (verifiable by construction — both import sites reference the
identical module export) AND that identical check configurations produce identical resulting state
regardless of which `trigger` value is passed (the only permitted difference is the `trigger` label
itself, recorded on the resulting `check_runs` row for attribution — never a difference in pass/fail
evaluation or threshold logic). This is this module's actual proof that Principle V's "first
scheduled-handler consumer" requirement is honored, not just claimed.

## 9. Frontend and Sentry-protocol framing

**Decision**: `UptimeScreen.tsx`/`CheckDetailScreen.tsx`/`AlertsScreen.tsx` follow the established
list→detail component-state navigation pattern (Module 2 onward) — no new navigation approach.

**On this module's relationship to Sentry's protocol**: Sentry DOES have a real "Uptime Monitoring"
product (confirmed open beta, distinct from its unrelated "Crons" heartbeat/check-in monitoring
feature) — its confirmed BEHAVIOR (polls a configured URL on an interval, alerts on non-200/timeout,
correlates downtime with traces/errors) is a reasonable UX/design inspiration, but its underlying
wire protocol isn't documented publicly in a way this project can ground implementation details in,
unlike errors/traces/logs (Modules 2-4), which all had concrete Sentry envelope-item-type grounding.
This module is accordingly framed as substantially FlightDeck-original — a genuine difference in
kind from Modules 2-5, not a gap in this research pass's thoroughness.

**Source**: https://changelog.sentry.dev/changelog/uptime-monitoring-now-in-open-beta/,
https://www.sentry.dev/product/uptime-monitoring/

## 10. Two real bugs found during live contract testing (not assumed, verified against real wrangler dev)

**`DELETE /checks/:id` FK-constraint failure**: the original implementation resolved any open
incident, then ran a bare `DELETE FROM checks WHERE id = ?1`. D1 enforces foreign keys, and both
`check_runs.check_id` and `incidents.check_id` `REFERENCES checks(id)` — deleting the `checks` row
while either table still had rows for it 500'd with `FOREIGN KEY constraint failed`. §6's "not left
dangling" framing (resolved, or clearly marked as belonging to a deleted check) can't be satisfied
by leaving a dangling FK either way once real deletion is required by the contract's `DELETE`
semantics, so the fix cascades the delete — `check_runs` then `incidents` then `checks`, in one
`db.batch()` — rather than trying to preserve incident rows referencing a check that no longer
exists.

**`PATCH /checks/:id` silently cleared `webhookUrl`**: the original implementation used
`COALESCE(?, column)` for every field except `webhook_url` (bound directly), on the theory that
`null` should mean "clear it." In practice, a PATCH body simply omitting `webhookUrl` (e.g. one that
only changes `target`, to drive the recovery half of a live incident test) also serializes to
`undefined` → bound as SQL `NULL`, indistinguishable from an explicit "clear the webhook" request —
so any partial update wiped a previously-configured webhook. Found live: a webhook-delivery contract
test's second (resolve-triggering) trigger never fired its webhook, traced to the intermediate PATCH
having silently nulled `webhookUrl`. Fixed by reading the existing row first and merging in
JavaScript (where `undefined` and `null` are still distinguishable) before writing the merged shape
back, rather than relying on SQL `COALESCE` to encode that distinction.

Both were caught by the contract test suite (`tests/contract/uptime-checks.spec.ts`) against a real
`wrangler dev` — a unit test with a hand-rolled fake D1 would not have caught either, since both are
genuine SQL/constraint-semantics bugs, not application-logic bugs. The real scheduled-cron dispatch
path (`worker/index.ts`'s `runDueUptimeChecks`) was separately verified live via `wrangler dev`'s
`/cdn-cgi/local/scheduled` simulation endpoint, confirming a due check runs with
`trigger:
"scheduled"` and `next_run_at` advances correctly (no immediate re-fire before the
configured interval elapses).
