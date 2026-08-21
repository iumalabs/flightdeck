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

// Item types other than "event" are recognized-and-skipped, never rejected (research.md §2) — a
// standard SDK routinely bundles session/transaction/etc. items alongside an event in one envelope.
export function isEventItem(item: EnvelopeItem): boolean {
  return item.header.type === "event";
}

export function parseEventPayload(item: EnvelopeItem): Record<string, unknown> | null {
  const decoder = new TextDecoder();
  return parseJsonLine(item.payload, decoder);
}
