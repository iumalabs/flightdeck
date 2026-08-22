import { DurableObject } from "cloudflare:workers";

// One instance per project (idFromName(projectId) at the call site) — research.md §7
// (specs/004-structured-logs). Uses the WebSocket Hibernation API (state.acceptWebSocket()) rather
// than the older always-in-memory pattern: Billable Duration charges don't accrue while a
// genuinely idle-but-open live-tail tab sits connected, and Cloudflare's own docs confirm no hard
// documented connection-count cap for this pattern.

export interface LiveTailRecord {
  timestamp: string;
  level: string;
  body: string;
  attributes: Record<string, unknown>;
  traceId: string | null;
}

export class LiveTail extends DurableObject {
  override fetch(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Called via RPC from the ingest route (research.md §7) — pushed in parallel with, never gated
  // on, the durable LOG_INGEST write; a viewer sees new records within moments regardless of when
  // the queue consumer eventually flushes them to R2/D1.
  broadcast(records: LiveTailRecord[]): void {
    const message = JSON.stringify({ records });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // A socket that went stale between getWebSockets() and send() — the Hibernation API's own
        // close/error handlers below are what actually clean these up; a failed send here is not
        // itself an error worth surfacing to the other, still-connected viewers.
      }
    }
  }

  // Live tail is server -> client only; the Hibernation API still requires these handlers to be
  // present so the runtime can wake this DO for incoming socket events without keeping it
  // permanently in memory.
  override webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {}

  // Acknowledges the close so the Hibernation API can fully release the socket. `code` here is
  // whatever the CLIENT sent when it closed — a browser navigating away or a network drop often
  // reports one of the WebSocket spec's reserved codes (1005 "No Status Received", 1006 "Abnormal
  // Closure"), which are legal to RECEIVE but illegal to pass back into `.close()` yourself
  // (confirmed live: threw "Invalid WebSocket close code" during e2e testing). Re-closing with a
  // valid code only when the received one is itself valid for that purpose.
  override webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    const isReservedOrInvalid = code === 1005 || code === 1006 || (code < 1000) ||
      (code > 1015 && code < 3000);
    try {
      ws.close(isReservedOrInvalid ? 1000 : code, reason);
    } catch {
      // Best-effort acknowledgment — the socket may already be fully closed by the time this runs.
    }
  }
}
