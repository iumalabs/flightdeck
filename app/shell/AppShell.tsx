import { useEffect, useState } from "react";
import type { Session } from "../lib/use-session.ts";
import { OverviewScreen } from "./OverviewScreen.tsx";
import { IssuesScreen } from "./IssuesScreen.tsx";
import { IssueDetailScreen } from "./IssueDetailScreen.tsx";
import { TracesScreen } from "./TracesScreen.tsx";
import { TraceDetailScreen } from "./TraceDetailScreen.tsx";
import { LogsScreen } from "./LogsScreen.tsx";
import { ReleasesScreen } from "./ReleasesScreen.tsx";
import { ReleaseDetailScreen } from "./ReleaseDetailScreen.tsx";
import { UptimeScreen } from "./UptimeScreen.tsx";
import { FeedbackScreen } from "./FeedbackScreen.tsx";
import { AlertsScreen } from "./AlertsScreen.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";
import { InstallSdkScreen } from "./InstallSdkScreen.tsx";

export interface AppShellProps {
  session: Session;
  signOut: () => void;
  navigate: (path: string) => void;
}

interface Project {
  id: string;
  name: string;
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

function renderScreen(
  screen: string,
  session: Session,
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
) {
  switch (screen) {
    case "overview":
      return <OverviewScreen session={session} />;
    case "issues":
      return <IssuesScreen onSelectIssue={onSelectIssue} />;
    case "issue-detail":
      return selectedIssueId
        ? (
          <IssueDetailScreen
            issueId={selectedIssueId}
            onBack={onBackToIssues}
            onViewTrace={onViewTrace}
          />
        )
        : <IssuesScreen onSelectIssue={onSelectIssue} />;
    case "release-detail":
      return selectedReleaseId
        ? (
          <ReleaseDetailScreen
            releaseId={selectedReleaseId}
            onBack={onBackToReleases}
            onSelectIssue={onSelectIssue}
          />
        )
        : <ReleasesScreen onSelectRelease={onSelectRelease} />;
    case "traces":
      return <TracesScreen onSelectTransaction={onSelectTransaction} />;
    case "trace-detail":
      return selectedTransactionId
        ? (
          <TraceDetailScreen
            transactionId={selectedTransactionId}
            onBack={onBackToTraces}
            onSelectIssue={onSelectIssue}
          />
        )
        : <TracesScreen onSelectTransaction={onSelectTransaction} />;
    case "logs":
      return <LogsScreen onSelectTrace={onViewTrace} />;
    case "releases":
      return <ReleasesScreen onSelectRelease={onSelectRelease} />;
    case "uptime":
      return <UptimeScreen />;
    case "feedback":
      return <FeedbackScreen />;
    case "alerts":
      return <AlertsScreen />;
    case "settings":
      return <SettingsScreen session={session} />;
    case "setup":
      return <InstallSdkScreen />;
    default:
      return <OverviewScreen session={session} />;
  }
}

export function AppShell({ session, signOut, navigate }: AppShellProps) {
  const [screen, setScreen] = useState("overview");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);

  const onSelectIssue = (id: string) => {
    setSelectedIssueId(id);
    setScreen("issue-detail");
  };
  const onBackToIssues = () => {
    setSelectedIssueId(null);
    setScreen("issues");
  };
  const onSelectTransaction = (id: string) => {
    setSelectedTransactionId(id);
    setScreen("trace-detail");
  };
  const onBackToTraces = () => {
    setSelectedTransactionId(null);
    setScreen("traces");
  };
  const onSelectRelease = (id: string) => {
    setSelectedReleaseId(id);
    setScreen("release-detail");
  };
  const onBackToReleases = () => {
    setSelectedReleaseId(null);
    setScreen("releases");
  };
  // Resolves an issue's traceId (the raw trace_id column) to a transactions.id via
  // contracts/traces-internal-api.md's by-trace-id lookup — not a direct id match
  // (specs/003-distributed-tracing).
  const onViewTrace = (traceId: string) => {
    fetch(`/api/internal/traces/by-trace-id/${traceId}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ transactionId: string | null }> : null))
      .then((data) => {
        if (data?.transactionId) onSelectTransaction(data.transactionId);
      })
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal/projects", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ projects: Project[] }> : null))
      .then((data) => {
        if (!cancelled && data) setProjects(data.projects);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const initials = session.email.slice(0, 2).toUpperCase();
  const currentProject = projects?.[0];

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
        </div>

        <div
          style={{
            margin: "0 10px 10px",
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--chip)",
            fontSize: 12.5,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
              flex: "none",
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentProject ? currentProject.name : "Loading…"}
          </span>
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
                  (item.screen === "releases" && screen === "release-detail");
                return (
                  <div
                    key={item.screen}
                    onClick={() => {
                      setSelectedIssueId(null);
                      setSelectedTransactionId(null);
                      setSelectedReleaseId(null);
                      setScreen(item.screen);
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
                onClick={() => setScreen(item.screen)}
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

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 32 }}>
        {renderScreen(
          screen,
          session,
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
        )}
      </div>
    </div>
  );
}
