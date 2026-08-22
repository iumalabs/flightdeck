import { resolveProjectByDsnKey } from "../ingest/dsn-auth.ts";
import { upsertDialogFeedback } from "./ingest.ts";

interface Env {
  DB: D1Database;
}

interface ParsedDsn {
  publicKey: string;
  projectId: string;
}

// The dialog's `dsn` query param carries the FULL DSN string
// (`https://{public_key}@{host}/{projectId}`) — a different encoding from the envelope path's bare
// `sentry_key`, confirmed from Sentry's own report-dialog.ts (research.md §1). `URL`'s `username`/
// `pathname` parse this directly; no hand-rolled string splitting needed.
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    return { publicKey, projectId };
  } catch {
    return null;
  }
}

// research.md §1's Decision: a self-contained script achieving the same real-SDK-compatible
// contract (script loads -> onLoad fires; postMessage("__sentry_reportdialog_closed__", ...) on
// close -> onClose fires) as Sentry's own JSONP-comment-templated rendering, without replicating
// that Sentry-monolith-specific mechanism. `submitUrl` is the exact request path + query string
// this GET was reached at (`request.get_full_path()`'s real-Sentry equivalent) — the dialog's own
// form POST goes back to this identical URL.
export function buildDialogScript(submitUrl: string): string {
  return `(function(){
  var overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif;";
  var box = document.createElement("div");
  box.style.cssText = "background:#fff;color:#111;padding:24px;border-radius:8px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3);";
  box.innerHTML = "<h2 style=\\"margin:0 0 12px;font-size:18px;\\">It looks like we're having issues.</h2>" +
    "<p style=\\"margin:0 0 16px;font-size:13px;color:#555;\\">Our team has been notified. If you'd like to help, tell us what happened below.</p>" +
    "<form id=\\"fd-feedback-form\\">" +
    "<input name=\\"name\\" placeholder=\\"Name\\" style=\\"display:block;width:100%;margin-bottom:8px;padding:8px;box-sizing:border-box;\\">" +
    "<input name=\\"email\\" placeholder=\\"Email\\" style=\\"display:block;width:100%;margin-bottom:8px;padding:8px;box-sizing:border-box;\\">" +
    "<textarea name=\\"comments\\" placeholder=\\"What happened?\\" required style=\\"display:block;width:100%;margin-bottom:12px;padding:8px;box-sizing:border-box;min-height:80px;\\"></textarea>" +
    "<div style=\\"display:flex;gap:8px;justify-content:flex-end;\\">" +
    "<button type=\\"button\\" id=\\"fd-feedback-cancel\\" style=\\"padding:8px 14px;\\">Cancel</button>" +
    "<button type=\\"submit\\" style=\\"padding:8px 14px;\\">Send</button>" +
    "</div></form>";
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    window.postMessage("__sentry_reportdialog_closed__", window.location.origin);
  }
  document.getElementById("fd-feedback-cancel").addEventListener("click", close);

  document.getElementById("fd-feedback-form").addEventListener("submit", function(e) {
    e.preventDefault();
    var form = e.target;
    var body = new URLSearchParams({
      name: form.name.value,
      email: form.email.value,
      comments: form.comments.value,
    });
    fetch(${JSON.stringify(submitUrl)}, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }).then(function() { close(); });
  });
})();`;
}

export async function handleDialogGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const dsn = url.searchParams.get("dsn");
  const eventId = url.searchParams.get("eventId");

  const parsedDsn = dsn ? parseDsn(dsn) : null;
  if (!parsedDsn) return new Response("Not Found", { status: 404 });

  const project = await resolveProjectByDsnKey(env.DB, parsedDsn.projectId, parsedDsn.publicKey);
  if (!project) return new Response("Not Found", { status: 404 });

  if (!eventId) return new Response("Bad Request", { status: 400 });

  const submitUrl = url.pathname + url.search;
  return new Response(buildDialogScript(submitUrl), {
    status: 200,
    headers: { "Content-Type": "text/javascript" },
  });
}

export async function handleDialogPost(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const dsn = url.searchParams.get("dsn");
  const eventId = url.searchParams.get("eventId");

  const parsedDsn = dsn ? parseDsn(dsn) : null;
  if (!parsedDsn) return new Response("Not Found", { status: 404 });

  const project = await resolveProjectByDsnKey(env.DB, parsedDsn.projectId, parsedDsn.publicKey);
  if (!project) return new Response("Not Found", { status: 404 });

  if (!eventId) return new Response("Bad Request", { status: 400 });

  const form = await request.formData().catch(() => null);
  const comments = form?.get("comments");
  if (typeof comments !== "string" || !comments) {
    return Response.json({ errors: { comments: "This field is required." } }, { status: 400 });
  }
  const name = form?.get("name");
  const email = form?.get("email");

  await upsertDialogFeedback(env.DB, parsedDsn.projectId, {
    message: comments,
    name: typeof name === "string" && name ? name : null,
    contactEmail: typeof email === "string" && email ? email : null,
    associatedEventId: eventId,
  });

  return Response.json({}, { status: 200 });
}
