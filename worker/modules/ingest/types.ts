// Shared event-payload shapes — data-model.md's Event entity and research.md §4
// (specs/002-error-monitoring). Deliberately loose (optional fields) since we accept payloads from
// two different SDK families (JS/browser and Python) whose actual field usage differs (research.md
// §4's note on JS vs Python frame field differences) — we validate what we use, not the whole shape.

export interface StackFrame {
  filename?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  vars?: Record<string, unknown>;
  // Set by sourcemap.ts's resolveStackTrace (User Story 3) — true when this frame was
  // successfully symbolicated against an uploaded source map, false when resolution was
  // attempted and didn't apply (no map for this release/path, or no release at all), absent on
  // frames that never went through resolution (e.g. a Python event, which has no minified form).
  resolved?: boolean;
}

export interface ExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: StackFrame[] };
}

export interface MessageInterface {
  formatted?: string;
  message?: string;
}

export interface Breadcrumb {
  timestamp?: string | number;
  type?: string;
  category?: string;
  message?: string;
  level?: string;
  data?: Record<string, unknown>;
}

// Sentry's standard user-context shape, set via `Sentry.setUser({...})` — see
// https://develop.sentry.dev/sdk/event-payloads/user/. Deliberately loose like the rest of this
// file: we surface what the SDK sends, we don't require any particular field.
export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
}

export interface EventPayload {
  event_id?: string;
  fingerprint?: string[];
  exception?: { values?: ExceptionValue[] };
  message?: string | MessageInterface;
  logentry?: MessageInterface;
  breadcrumbs?: { values?: Breadcrumb[] } | Breadcrumb[];
  level?: string;
  platform?: string;
  release?: string;
  environment?: string;
  timestamp?: string | number;
  tags?: Record<string, string>;
  contexts?: Record<string, unknown>;
  user?: UserContext;
}
