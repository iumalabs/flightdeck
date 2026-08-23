// Incident webhook delivery (spec User Story 4, research.md §7) — single attempt, short timeout,
// no retry, no queue. Genuinely decoupled from the incident state transition it reports on: a
// failing/unreachable webhook target MUST NOT throw out of runCheck() or prevent/corrupt the
// incident record it's describing (spec FR-011).

export interface WebhookPayload {
  checkId: string;
  checkName: string;
  event: "incident.opened" | "incident.resolved";
  incidentId: string;
}

const WEBHOOK_TIMEOUT_MS = 5_000;

export async function deliverWebhook(url: string, payload: WebhookPayload): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // fire-and-forget — a failed/unreachable webhook must never affect the caller (spec FR-011)
  } finally {
    clearTimeout(timeout);
  }
}
