import type { EventPayload, ExceptionValue, StackFrame } from "./types.ts";

// Pure functions, no bindings — research.md §5 (specs/002-error-monitoring). Order: explicit
// client-supplied fingerprint > stacktrace-based > message-based. The caller (routes.ts) is
// responsible for resolving source maps BEFORE calling these — see sourcemap.ts's stub and
// research.md §5's ordering rationale (grouping the raw minified trace would fingerprint the same
// logical bug differently across builds).

function primaryException(event: EventPayload): ExceptionValue | undefined {
  const values = event.exception?.values;
  return values && values.length > 0 ? values[values.length - 1] : undefined;
}

function relevantFrames(frames: StackFrame[]): StackFrame[] {
  const inApp = frames.filter((f) => f.in_app !== false);
  return inApp.length > 0 ? inApp : frames;
}

function messageText(event: EventPayload): string {
  if (typeof event.message === "string") return event.message;
  if (event.message?.formatted) return event.message.formatted;
  if (event.message?.message) return event.message.message;
  if (event.logentry?.formatted) return event.logentry.formatted;
  if (event.logentry?.message) return event.logentry.message;
  return "unknown";
}

export function computeFingerprint(event: EventPayload): string {
  if (event.fingerprint && event.fingerprint.length > 0) {
    return event.fingerprint.join("|");
  }

  const exceptionValue = primaryException(event);
  const frames = exceptionValue?.stacktrace?.frames;
  if (exceptionValue && frames && frames.length > 0) {
    const signature = relevantFrames(frames)
      .map((f) => `${f.module ?? f.filename ?? "?"}:${f.function ?? "?"}`)
      .join(">");
    return `stack:${exceptionValue.type ?? "Error"}:${signature}`;
  }

  return `message:${messageText(event)}`;
}

export function deriveTitle(event: EventPayload): string {
  const exceptionValue = primaryException(event);
  if (exceptionValue) {
    return exceptionValue.value
      ? `${exceptionValue.type ?? "Error"}: ${exceptionValue.value}`
      : (exceptionValue.type ?? "Error");
  }
  return messageText(event);
}

// The innermost (last) relevant frame — where the exception was actually raised. Shared by
// deriveCulprit (the function/module name shown as the issue's culprit) and User Story 4's
// suspect-commit lookup (which needs this same frame's file path).
export function deriveCulpritFrame(event: EventPayload): StackFrame | null {
  const frames = primaryException(event)?.stacktrace?.frames;
  if (!frames || frames.length === 0) return null;
  return relevantFrames(frames).at(-1) ?? null;
}

export function deriveCulprit(event: EventPayload): string | null {
  const top = deriveCulpritFrame(event);
  if (!top) return null;
  return top.function ?? top.module ?? top.filename ?? null;
}
