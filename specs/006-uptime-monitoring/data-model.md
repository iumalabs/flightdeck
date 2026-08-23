# Phase 1 Data Model: Uptime Monitoring

## Check

| Field                   | Type                                    | Notes                                                    |
| ----------------------- | --------------------------------------- | -------------------------------------------------------- |
| `id`                    | TEXT, PRIMARY KEY                       |                                                          |
| `project_id`            | TEXT, NOT NULL, REFERENCES projects(id) |                                                          |
| `name`                  | TEXT, NOT NULL                          |                                                          |
| `type`                  | TEXT, NOT NULL                          | `'http'` or `'tcp'`.                                     |
| `target`                | TEXT, NOT NULL                          | A URL for `http`, `host:port` for `tcp`.                 |
| `interval_seconds`      | INTEGER, NOT NULL                       | `>= 60` (research.md §4).                                |
| `failure_threshold`     | INTEGER, NOT NULL, DEFAULT 3            | Consecutive failures to open an incident.                |
| `recovery_threshold`    | INTEGER, NOT NULL, DEFAULT 2            | Consecutive successes to auto-resolve.                   |
| `webhook_url`           | TEXT, NULLABLE                          | Optional (spec User Story 4).                            |
| `consecutive_failures`  | INTEGER, NOT NULL, DEFAULT 0            | Reset to 0 on any success.                               |
| `consecutive_successes` | INTEGER, NOT NULL, DEFAULT 0            | Reset to 0 on any failure.                               |
| `status`                | TEXT, NOT NULL, DEFAULT `'unknown'`     | `'up'`, `'down'`, or `'unknown'` (no runs yet).          |
| `next_run_at`           | TEXT, NOT NULL                          | What the scheduled handler's due-check query filters on. |

**Validation rules**: `interval_seconds >= 60` (research.md §4); a project may have at most 20
checks (research.md §4's abuse-prevention cap, enforced at creation time, not a DB constraint — a
friendly `400`/`403`-shaped rejection, not a raw constraint-violation error).

**State transitions**: `consecutive_failures`/`consecutive_successes`/`status` are updated
atomically by `runCheck()` (research.md §8) after every run, regardless of `trigger`. Reaching
`failure_threshold` opens an `Incident` (if none is already open); reaching `recovery_threshold`
resolves the currently-open `Incident` (if any).

## Check Run

| Field        | Type                                      | Notes                                                                                                 |
| ------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`         | TEXT, PRIMARY KEY                         |                                                                                                       |
| `check_id`   | TEXT, NOT NULL, REFERENCES checks(id)     |                                                                                                       |
| `trigger`    | TEXT, NOT NULL                            | `'scheduled'` or `'interactive'` — attribution only, never affects evaluation logic (research.md §8). |
| `succeeded`  | INTEGER (boolean), NOT NULL               |                                                                                                       |
| `latency_ms` | INTEGER, NULLABLE                         | Null if the check failed before establishing a connection.                                            |
| `detail`     | TEXT, NULLABLE                            | HTTP status code, or a short error description for a failure.                                         |
| `run_at`     | TEXT, NOT NULL, DEFAULT `datetime('now')` | What the retention job (research.md §5) prunes against.                                               |

**Validation rules**: insert-only from `runCheck()`. Pruned by the retention job once `run_at`
exceeds 30 days (research.md §5) — full deletion, no partial-preservation scheme (this table has no
separate summary row the way Module 2's issues/events split does; `checks`' own
`status`/`consecutive_*` columns already ARE the durable summary, unaffected by `check_runs`
pruning).

**Indexes**: `(check_id, run_at)` — powers both the recent-history view and the retention prune.

## Incident

| Field         | Type                                      | Notes            |
| ------------- | ----------------------------------------- | ---------------- |
| `id`          | TEXT, PRIMARY KEY                         |                  |
| `check_id`    | TEXT, NOT NULL, REFERENCES checks(id)     |                  |
| `opened_at`   | TEXT, NOT NULL, DEFAULT `datetime('now')` |                  |
| `resolved_at` | TEXT, NULLABLE                            | Null while open. |

**Validation rules**: at most one row per `check_id` with `resolved_at IS NULL` at a time (an
already-open incident is not duplicated by further consecutive failures — spec FR-007). NOT pruned
by the retention job (research.md §5 — low-volume summary data, unlike `check_runs`).

**State transitions**:

- (none open) → opened, when `runCheck()` observes `consecutive_failures` reaching
  `failure_threshold`.
- opened → resolved (`resolved_at` set), when `runCheck()` observes `consecutive_successes` reaching
  `recovery_threshold`.
- opened → resolved, when the owning `Check` is deleted (research.md §6 — auto-resolved as part of
  the same delete operation, never left dangling).

## Cross-entity relationship: check → incidents → check_runs

An `Incident` always references exactly one `Check`. `Check_Run` rows are the raw evidence
`runCheck()` uses to decide whether to open/resolve an `Incident`, but there's no direct FK from
`Check_Run` to `Incident` — the relationship is temporal (an incident's `opened_at`/`resolved_at`
window brackets the run of `check_runs` rows that caused it), not a stored reference, since
`check_runs` is a pruned, high-frequency table and an `Incident` (unpruned, low-volume) shouldn't
have its own existence depend on rows that may later be deleted by retention.
