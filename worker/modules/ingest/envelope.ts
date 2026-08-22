// Envelope grammar parser — research.md §2 (specs/002-error-monitoring):
//   Envelope = Headers { "\n" Item } [ "\n" ] ;
//   Item = Headers "\n" Payload ;
// Operates on raw bytes (not text.split("\n")) so an item header's declared `length` is honored in
// bytes, matching the real protocol — a naive newline-split would break on any payload that
// happens to contain a literal newline byte.

const NEWLINE = 0x0a;

export interface EnvelopeItem {
  header: Record<string, unknown>;
  payload: Uint8Array;
}

export interface ParsedEnvelope {
  header: Record<string, unknown>;
  items: EnvelopeItem[];
}

function findNewline(bytes: Uint8Array, start: number): number {
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === NEWLINE) return i;
  }
  return -1;
}

function parseJsonLine(bytes: Uint8Array, decoder: TextDecoder): Record<string, unknown> | null {
  try {
    const value = JSON.parse(decoder.decode(bytes));
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// Returns null for a malformed envelope (unparseable header/item-header JSON, or a declared
// `length` that overruns the body) — the caller MUST reject the request without processing any
// items, rather than attempting to salvage a partial parse (constitution Principle III: fail
// closed, no degraded-but-permitted mode).
export function parseEnvelope(bytes: Uint8Array): ParsedEnvelope | null {
  const decoder = new TextDecoder();
  let pos = 0;

  const headerEnd = findNewline(bytes, pos);
  const headerBytes = headerEnd === -1 ? bytes.subarray(pos) : bytes.subarray(pos, headerEnd);
  const header = parseJsonLine(headerBytes, decoder);
  if (header === null) return null;
  pos = headerEnd === -1 ? bytes.length : headerEnd + 1;

  const items: EnvelopeItem[] = [];
  while (pos < bytes.length) {
    const itemHeaderEnd = findNewline(bytes, pos);
    if (itemHeaderEnd === -1) return null; // an item header must always be newline-terminated

    const itemHeader = parseJsonLine(bytes.subarray(pos, itemHeaderEnd), decoder);
    if (itemHeader === null) return null;
    pos = itemHeaderEnd + 1;

    const length = itemHeader.length;
    let payloadEnd: number;
    if (typeof length === "number") {
      payloadEnd = pos + length;
      if (payloadEnd > bytes.length) return null; // truncated body
    } else {
      const nl = findNewline(bytes, pos);
      payloadEnd = nl === -1 ? bytes.length : nl;
    }

    items.push({ header: itemHeader, payload: bytes.subarray(pos, payloadEnd) });
    pos = payloadEnd;
    if (bytes[pos] === NEWLINE) pos += 1;
  }

  return { header, items };
}

// Item types other than "event"/"transaction" are recognized-and-skipped, never rejected
// (research.md §2) — a standard SDK routinely bundles session/etc. items alongside an event or
// transaction in one envelope.
export function isEventItem(item: EnvelopeItem): boolean {
  return item.header.type === "event";
}

// "transaction" is mutually exclusive with "event" within one envelope item, per Sentry's own
// protocol (specs/003-distributed-tracing research.md §2) — never both on the same item.
export function isTransactionItem(item: EnvelopeItem): boolean {
  return item.header.type === "transaction";
}

// A "log" item batches MANY independent log records (up to 100, SDK-side cap) inside one item's
// payload — a materially different shape from "event"/"transaction" (specs/004-structured-logs
// research.md §1), but still just another item type in the same envelope.
export function isLogItem(item: EnvelopeItem): boolean {
  return item.header.type === "log";
}

// Same generic JSON decode as parseEventPayload/parseTransactionPayload — a distinct name only for
// call-site clarity at the "log" dispatch branch.
export function parseLogPayload(item: EnvelopeItem): Record<string, unknown> | null {
  const decoder = new TextDecoder();
  return parseJsonLine(item.payload, decoder);
}

export function parseEventPayload(item: EnvelopeItem): Record<string, unknown> | null {
  const decoder = new TextDecoder();
  return parseJsonLine(item.payload, decoder);
}

// Same generic JSON decode as parseEventPayload — a distinct name only for call-site clarity at
// the "transaction" dispatch branch (specs/003-distributed-tracing research.md §2).
export function parseTransactionPayload(item: EnvelopeItem): Record<string, unknown> | null {
  const decoder = new TextDecoder();
  return parseJsonLine(item.payload, decoder);
}

// "session" (one session update) or "sessions" (a pre-aggregated batch) — both feed the same
// aggregation function (specs/005-releases research.md §5). Server-mode SDKs SHOULD pre-aggregate
// before sending, so "sessions" is the common case in practice, "session" the simpler one.
export function isSessionItem(item: EnvelopeItem): boolean {
  return item.header.type === "session" || item.header.type === "sessions";
}

export function parseSessionPayload(item: EnvelopeItem): Record<string, unknown> | null {
  const decoder = new TextDecoder();
  return parseJsonLine(item.payload, decoder);
}

// Event-based, at most one per envelope (specs/007-user-feedback research.md §3, spec.md's
// protocol grounding) — mirrors isEventItem() exactly.
export function isFeedbackItem(item: EnvelopeItem): boolean {
  return item.header.type === "feedback";
}

// Same generic JSON decode as parseEventPayload — a distinct name only for call-site clarity at
// the "feedback" dispatch branch.
export function parseFeedbackPayload(item: EnvelopeItem): Record<string, unknown> | null {
  const decoder = new TextDecoder();
  return parseJsonLine(item.payload, decoder);
}
