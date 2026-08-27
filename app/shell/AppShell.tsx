/// <reference path="../vite-env.d.ts" />
import { useCallback, useEffect, useState } from "react";
import type { Session } from "../lib/use-session.ts";
import { useSelectedProject } from "../lib/use-selected-project.ts";
import { OverviewScreen } from "./OverviewScreen.tsx";
import { IssuesScreen } from "./IssuesScreen.tsx";
import { IssueDetailScreen } from "./IssueDetailScreen.tsx";
import { TracesScreen } from "./TracesScreen.tsx";
import { TraceDetailScreen } from "./TraceDetailScreen.tsx";
import { LogsScreen } from "./LogsScreen.tsx";
import { ReleasesScreen } from "./ReleasesScreen.tsx";
import { ReleaseDetailScreen } from "./ReleaseDetailScreen.tsx";
import { UptimeScreen } from "./UptimeScreen.tsx";
import { CheckDetailScreen } from "./CheckDetailScreen.tsx";
import { FeedbackScreen } from "./FeedbackScreen.tsx";
import { AlertsScreen } from "./AlertsScreen.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";
import { InstallSdkScreen } from "./InstallSdkScreen.tsx";

export interface AppShellProps {
  session: Session;
  signOut: () => void;
  navigate: (path: string) => void;
  pathname: string;
}

interface Project {
  id: string;
  name: string;
  dsn: string;
}

interface NavItem {
  screen: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { screen: "overview", label: "Overview" },
      { screen: "issues", label: "Issues" },
      { screen: "traces", label: "Traces" },
      { screen: "logs", label: "Logs" },
    ],
  },
  {
    label: "Ship",
    items: [
      { screen: "releases", label: "Releases" },
      { screen: "uptime", label: "Uptime" },
    ],
  },
  {
    label: "Respond",
    items: [
      { screen: "feedback", label: "Feedback" },
      { screen: "alerts", label: "Alerts" },
    ],
  },
];

const FOOTER_ITEMS: NavItem[] = [
  { screen: "settings", label: "Settings" },
  { screen: "setup", label: "Install SDK" },
];

const KNOWN_SCREENS = new Set<string>([
  ...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.screen)),
  ...FOOTER_ITEMS.map((item) => item.screen),
]);

// issue #58 — the app-shell path prefix App.tsx routes on (kept in sync with the same literal
// there; both hardcode "/web-app" rather than sharing an import, since this is the only place in
// AppShell.tsx that needs it).
const APP_SHELL_PATH_PREFIX = "/web-app";

// issue #109 — maps a list screen's URL segment to the internal "detail" screen name shown when an
// id segment follows it, e.g. "/web-app/issues/abc" -> screen "issue-detail". "feedback" is
// deliberately absent: FeedbackScreen renders its own list/detail split from a single screen name
// (see FeedbackScreen.tsx), so a feedback id segment changes which item it shows, not which
// internal screen is selected.
const DETAIL_SCREEN_FOR_LIST: Record<string, string> = {
  issues: "issue-detail",
  traces: "trace-detail",
  releases: "release-detail",
  uptime: "check-detail",
};

interface ParsedPathname {
  screen: string;
  detailId: string | null;
}

// URL -> screen (+ optional selected-item id). issue #58 made the top-level sidebar screens
// addressable; issue #109 extends that one level deeper so the specific issue/trace/release/uptime
// check/feedback item selected within a screen is also addressable, bookmarkable, and survives a
// reload — the second pathname segment, if present, is that item's id. Anything unrecognized,
// including the bare "/" and "/web-app" roots, falls back to Overview.
function parsePathname(pathname: string): ParsedPathname {
  const prefix = `${APP_SHELL_PATH_PREFIX}/`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  const [segment, idSegment] = rest.split("/");

  if (!segment || !KNOWN_SCREENS.has(segment)) {
    return { screen: "overview", detailId: null };
  }
  if (!idSegment) {
    return { screen: segment, detailId: null };
  }

  let detailId: string;
  try {
    detailId = decodeURIComponent(idSegment);
  } catch {
    detailId = idSegment;
  }
  return { screen: DETAIL_SCREEN_FOR_LIST[segment] ?? segment, detailId };
}

// screen -> URL, the inverse of parsePathname for the top-level (no-id) case (Overview normalizes
// to the bare prefix, not "/web-app/overview").
function pathForScreen(screen: string): string {
  return screen === "overview" ? APP_SHELL_PATH_PREFIX : `${APP_SHELL_PATH_PREFIX}/${screen}`;
}

// screen -> URL for a specific selected item, e.g. pathForDetail("issues", "abc") ->
// "/web-app/issues/abc".
function pathForDetail(listScreen: string, id: string): string {
  return `${pathForScreen(listScreen)}/${encodeURIComponent(id)}`;
}

// issues/38 — a native <select> only themes its closed box; the open popup falls back to
// browser/OS styling (never restylable via CSS on <option>), clashing hard with the dark theme.
// The design source (FlightDeckApp.dc.html) implements this exact switcher as a custom
// click-to-open panel for the same reason — matching that pattern here, not just patching colors.
function ProjectSwitcher(
  { projects, selectedProjectId, onSelect, onCreateNew }: {
    projects: Project[];
    selectedProjectId: string | null;
    onSelect: (id: string) => void;
    onCreateNew: () => void;
  },
) {
  const [open, setOpen] = useState(false);
  const current = projects.find((p) => p.id === selectedProjectId) ?? projects[0];

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch project"
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: "var(--accent)",
            color: "var(--accent-fg)",
            fontWeight: 700,
            fontSize: 9.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            flex: "none",
          }}
        >
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {current.name}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--fg3)"
          strokeWidth="2"
          style={{ flex: "none", transform: open ? "rotate(180deg)" : "none" }}
          aria-hidden="true"
        >
          <path d="M8 10l4 4 4-4" />
        </svg>
      </div>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: -10,
              right: -10,
              zIndex: 41,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              boxShadow: "0 16px 38px rgba(0,0,0,.42)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "8px 10px",
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--fg4)",
                borderBottom: "1px solid var(--line2)",
              }}
            >
              {projects.length} projects
            </div>
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                }}
                role="option"
                aria-selected={p.id === selectedProjectId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    background: "var(--chip)",
                    color: "var(--fg2)",
                    fontWeight: 700,
                    fontSize: 9.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-display)",
                    flex: "none",
                  }}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12.5,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: p.id === selectedProjectId ? "var(--fg)" : "var(--fg2)",
                  }}
                >
                  {p.name}
                </span>
                {p.id === selectedProjectId && (
                  <span style={{ color: "var(--accent)", fontSize: 12, flex: "none" }}>✓</span>
                )}
              </div>
            ))}
            <div
              onClick={() => {
                onCreateNew();
                setOpen(false);
              }}
              style={{
                padding: "9px 10px",
                borderTop: "1px solid var(--line2)",
                fontSize: 12,
                color: "var(--accent)",
                cursor: "pointer",
              }}
            >
              + New project
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function renderScreen(
  screen: string,
  session: Session,
  projectId: string | null,
  projects: Project[] | null,
  onProjectCreated: (project: Project) => void,
  selectedIssueId: string | null,
  onSelectIssue: (id: string) => void,
  onBackToIssues: () => void,
  selectedTransactionId: string | null,
  onSelectTransaction: (id: string) => void,
  onBackToTraces: () => void,
  onViewTrace: (traceId: string) => void,
  selectedReleaseId: string | null,
  onSelectRelease: (id: string) => void,
  onBackToReleases: () => void,
  selectedCheckId: string | null,
  onSelectCheck: (id: string) => void,
  onBackToUptime: () => void,
  selectedFeedbackId: string | null,
  onSelectFeedback: (id: string) => void,
  onBackToFeedback: () => void,
) {
  switch (screen) {
    case "overview":
      return <OverviewScreen session={session} projectId={projectId} />;
    case "issues":
      return <IssuesScreen projectId={projectId} onSelectIssue={onSelectIssue} />;
    case "issue-detail":
      return selectedIssueId
        ? (
          <IssueDetailScreen
            issueId={selectedIssueId}
            projectId={projectId}
            onBack={onBackToIssues}
            onViewTrace={onViewTrace}
          />
        )
        : <IssuesScreen projectId={projectId} onSelectIssue={onSelectIssue} />;
    case "release-detail":
      return selectedReleaseId
        ? (
          <ReleaseDetailScreen
            releaseId={selectedReleaseId}
            projectId={projectId}
            onBack={onBackToReleases}
            onSelectIssue={onSelectIssue}
          />
        )
        : <ReleasesScreen projectId={projectId} onSelectRelease={onSelectRelease} />;
    case "traces":
      return <TracesScreen projectId={projectId} onSelectTransaction={onSelectTransaction} />;
    case "trace-detail":
      return selectedTransactionId
        ? (
          <TraceDetailScreen
            transactionId={selectedTransactionId}
            projectId={projectId}
            onBack={onBackToTraces}
            onSelectIssue={onSelectIssue}
          />
        )
        : <TracesScreen projectId={projectId} onSelectTransaction={onSelectTransaction} />;
    case "logs":
      return <LogsScreen projectId={projectId} onSelectTrace={onViewTrace} />;
    case "releases":
      return <ReleasesScreen projectId={projectId} onSelectRelease={onSelectRelease} />;
    case "uptime":
      return <UptimeScreen projectId={projectId} onSelectCheck={onSelectCheck} />;
    case "check-detail":
      return selectedCheckId
        ? (
          <CheckDetailScreen
            checkId={selectedCheckId}
            projectId={projectId}
            onBack={onBackToUptime}
          />
        )
        : <UptimeScreen projectId={projectId} onSelectCheck={onSelectCheck} />;
    case "feedback":
      return (
        <FeedbackScreen
          projectId={projectId}
          selectedFeedbackId={selectedFeedbackId}
          onSelectFeedback={onSelectFeedback}
          onBackToFeedback={onBackToFeedback}
          onSelectIssue={onSelectIssue}
        />
      );
    case "alerts":
      return <AlertsScreen projectId={projectId} onSelectCheck={onSelectCheck} />;
    case "settings":
      return (
        <SettingsScreen
          session={session}
          project={projects?.find((p) => p.id === projectId) ?? null}
          onProjectCreated={onProjectCreated}
        />
      );
    case "setup":
      return <InstallSdkScreen project={projects?.find((p) => p.id === projectId) ?? null} />;
    default:
      return <OverviewScreen session={session} projectId={projectId} />;
  }
}

export function AppShell({ session, signOut, navigate, pathname }: AppShellProps) {
  const initialParsed = parsePathname(pathname);
  const [screen, setScreen] = useState(initialParsed.screen);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    initialParsed.screen === "issue-detail" ? initialParsed.detailId : null,
  );
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(
    initialParsed.screen === "trace-detail" ? initialParsed.detailId : null,
  );
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(
    initialParsed.screen === "release-detail" ? initialParsed.detailId : null,
  );
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(
    initialParsed.screen === "check-detail" ? initialParsed.detailId : null,
  );
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(
    initialParsed.screen === "feedback" ? initialParsed.detailId : null,
  );
  const [projects, setProjects] = useState<Project[] | null>(null);

  // issue #58 — keeps `screen` in sync with the URL beyond just the initial mount: browser
  // back/forward (popstate, plumbed through App.tsx's usePathname) changes `pathname` without any
  // sidebar click, so the active screen needs to follow it here too. The initial-mount case is
  // already handled by the useState initializers above; this covers every pathname change after
  // that (including the navigate() calls sidebar clicks and onSelectX/onBackToX handlers make
  // below, which is a harmless no-op since state is already set to the same values by then).
  // issue #109 — also re-derives the selected-item id for whichever detail screen the URL now
  // points at (and clears the others), so a direct visit to a detail URL, and back/forward between
  // two different detail URLs, both work without any prior in-app navigation.
  useEffect(() => {
    const parsed = parsePathname(pathname);
    setScreen(parsed.screen);
    setSelectedIssueId(parsed.screen === "issue-detail" ? parsed.detailId : null);
    setSelectedTransactionId(parsed.screen === "trace-detail" ? parsed.detailId : null);
    setSelectedReleaseId(parsed.screen === "release-detail" ? parsed.detailId : null);
    setSelectedCheckId(parsed.screen === "check-detail" ? parsed.detailId : null);
    setSelectedFeedbackId(parsed.screen === "feedback" ? parsed.detailId : null);
  }, [pathname]);

  const onSelectIssue = (id: string) => {
    setSelectedIssueId(id);
    setScreen("issue-detail");
    navigate(pathForDetail("issues", id));
  };
  const onBackToIssues = () => {
    setSelectedIssueId(null);
    setScreen("issues");
    navigate(pathForScreen("issues"));
  };
  const onSelectTransaction = (id: string) => {
    setSelectedTransactionId(id);
    setScreen("trace-detail");
    navigate(pathForDetail("traces", id));
  };
  const onBackToTraces = () => {
    setSelectedTransactionId(null);
    setScreen("traces");
    navigate(pathForScreen("traces"));
  };
  const onSelectRelease = (id: string) => {
    setSelectedReleaseId(id);
    setScreen("release-detail");
    navigate(pathForDetail("releases", id));
  };
  const onBackToReleases = () => {
    setSelectedReleaseId(null);
    setScreen("releases");
    navigate(pathForScreen("releases"));
  };
  const onSelectCheck = (id: string) => {
    setSelectedCheckId(id);
    setScreen("check-detail");
    navigate(pathForDetail("uptime", id));
  };
  const onBackToUptime = () => {
    setSelectedCheckId(null);
    setScreen("uptime");
    navigate(pathForScreen("uptime"));
  };
  const onSelectFeedback = (id: string) => {
    setSelectedFeedbackId(id);
    navigate(pathForDetail("feedback", id));
  };
  const onBackToFeedback = () => {
    setSelectedFeedbackId(null);
    navigate(pathForScreen("feedback"));
  };
  // Resolves an issue's traceId (the raw trace_id column) to a transactions.id via
  // contracts/traces-internal-api.md's by-trace-id lookup — not a direct id match
  // (specs/003-distributed-tracing).
  const onViewTrace = (traceId: string) => {
    const params = selectedProjectId ? `?project=${selectedProjectId}` : "";
    fetch(`/api/internal/v1/traces/by-trace-id/${traceId}${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ transactionId: string | null }> : null))
      .then((data) => {
        if (data?.transactionId) onSelectTransaction(data.transactionId);
      })
      .catch(() => {});
  };

  const refetchProjects = useCallback(() => {
    return fetch("/api/internal/v1/projects", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ projects: Project[] }> : null))
      .then((data) => {
        setProjects(data?.projects ?? []);
      })
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    refetchProjects();
  }, [refetchProjects]);

  const { selectedProjectId, selectProject } = useSelectedProject(projects);

  // specs/008-multi-project-support — the newly-created project isn't in `projects` yet (that list
  // was fetched before this POST resolved), so it's appended locally and selected immediately
  // rather than waiting on a second round-trip through refetchProjects().
  const onProjectCreated = (project: Project) => {
    setProjects((prev) => [...(prev ?? []), project]);
    selectProject(project.id);
  };

  const initials = session.email.slice(0, 2).toUpperCase();
  const currentProject = projects?.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", color: "var(--fg)" }}>
      <div
        style={{
          width: 228,
          flex: "none",
          borderRight: "1px solid var(--line)",
          background: "var(--panel)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          onClick={() => navigate("/")}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: 16, cursor: "pointer" }}
        >
          <svg width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="24" stroke="#B8F135" strokeWidth="6" />
            <path d="M14 39H50" stroke="#B8F135" strokeWidth="6" strokeLinecap="round" />
            <path d="M32 18L38.5 28H25.5L32 18Z" fill="#B8F135" />
          </svg>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>
            FlightDeck
          </span>
          {
            /* issues/25 — not in the design mockup's sidebar header; kept small/muted so it
              doesn't compete with the wordmark. */
          }
          <span
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg4)" }}
          >
            v{__APP_VERSION__}
          </span>
        </div>

        <div
          style={{
            margin: "0 10px 10px",
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--chip)",
            fontSize: 12.5,
          }}
        >
          {
            /* spec FR-009 — a single-project workspace renders plain text, no extra step imposed;
              the switcher only appears once there's something to switch to. */
          }
          {projects && projects.length > 1
            ? (
              <ProjectSwitcher
                projects={projects}
                selectedProjectId={selectedProjectId}
                onSelect={selectProject}
                onCreateNew={() => {
                  setScreen("settings");
                  navigate(pathForScreen("settings"));
                }}
              />
            )
            : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    flex: "none",
                  }}
                />
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {currentProject ? currentProject.name : "Loading…"}
                </span>
              </div>
            )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--fg4)",
                  padding: "6px 10px",
                }}
              >
                {group.label}
              </div>
              {group.items.map((item) => {
                // "issue-detail"/"trace-detail" are conceptually sub-screens of "issues"/"traces"
                // — keep the nav item highlighted while viewing a specific issue or transaction.
                const isActive = screen === item.screen ||
                  (item.screen === "issues" && screen === "issue-detail") ||
                  (item.screen === "traces" && screen === "trace-detail") ||
                  (item.screen === "releases" && screen === "release-detail") ||
                  (item.screen === "uptime" && screen === "check-detail");
                return (
                  <div
                    key={item.screen}
                    onClick={() => {
                      setSelectedIssueId(null);
                      setSelectedTransactionId(null);
                      setSelectedReleaseId(null);
                      setSelectedCheckId(null);
                      setSelectedFeedbackId(null);
                      setScreen(item.screen);
                      navigate(pathForScreen(item.screen));
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      fontSize: 13.5,
                      cursor: "pointer",
                      color: isActive ? "var(--accent)" : "var(--fg2)",
                      background: isActive ? "rgba(184,241,53,.08)" : "transparent",
                    }}
                  >
                    {item.label}
                  </div>
                );
              })}
            </div>
          ))}

          <div style={{ borderTop: "1px solid var(--line2)", marginTop: 8, paddingTop: 8 }}>
            {FOOTER_ITEMS.map((item) => (
              <div
                key={item.screen}
                onClick={() => {
                  setScreen(item.screen);
                  navigate(pathForScreen(item.screen));
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 13.5,
                  cursor: "pointer",
                  color: screen === item.screen ? "var(--accent)" : "var(--fg2)",
                  background: screen === item.screen ? "rgba(184,241,53,.08)" : "transparent",
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--chip)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              flex: "none",
            }}
          >
            {initials}
          </div>
          <span
            style={{
              fontSize: 12.5,
              color: "var(--fg2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {session.email}
          </span>
          <span
            onClick={signOut}
            title="Sign out"
            style={{ marginLeft: "auto", cursor: "pointer", color: "var(--fg3)", fontSize: 12.5 }}
          >
            Sign out
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", padding: 32 }}>
        {renderScreen(
          screen,
          session,
          selectedProjectId,
          projects,
          onProjectCreated,
          selectedIssueId,
          onSelectIssue,
          onBackToIssues,
          selectedTransactionId,
          onSelectTransaction,
          onBackToTraces,
          onViewTrace,
          selectedReleaseId,
          onSelectRelease,
          onBackToReleases,
          selectedCheckId,
          onSelectCheck,
          onBackToUptime,
          selectedFeedbackId,
          onSelectFeedback,
          onBackToFeedback,
        )}
      </div>
    </div>
  );
}
