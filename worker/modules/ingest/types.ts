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
}
