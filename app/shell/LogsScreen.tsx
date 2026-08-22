import { useEffect, useRef, useState } from "react";

interface LogLine {
  timestamp: string;
  level: string;
  body: string;
  attributes: Record<string, unknown>;
  traceId: string | null;
}

const LEVEL_COLOR: Record<string, string> = {
  trace: "var(--fg3)",
  debug: "var(--fg3)",
  info: "#4FD1C5",
  warn: "#FFC53D",
  error: "#FF4D4D",
  fatal: "#FF4D4D",
};

function LogRow(
  { line, onSelectTrace }: { line: LogLine; onSelectTrace?: (traceId: string) => void },
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "6px 14px",
        borderBottom: "1px solid var(--line2)",
        fontSize: 12.5,
      }}
    >
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg3)", flex: "none" }}>
        {line.timestamp}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          color: LEVEL_COLOR[line.level] ?? "var(--fg2)",
          flex: "none",
          width: 48,
          textTransform: "uppercase",
        }}
      >
        {line.level}
      </span>
      <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{line.body}</span>
      {line.traceId && onSelectTrace && (
        <span
          onClick={() => onSelectTrace(line.traceId!)}
          style={{ cursor: "pointer", color: "var(--accent)", flex: "none", fontSize: 11.5 }}
        >
          trace →
        </span>
      )}
    </div>
  );
}

function LiveTail({ onSelectTrace }: { onSelectTrace?: (traceId: string) => void }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [level, setLevel] = useState("");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/api/internal/logs/live-tail`);
    socketRef.current = socket;
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { records: LogLine[] };
        setLines((prev) => [...data.records, ...prev].slice(0, 500));
      } catch {
        // ignore a malformed frame
      }
    };
    return () => socket.close();
  }, []);

  const visible = level ? lines.filter((line) => line.level === level) : lines;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {["", "trace", "debug", "info", "warn", "error", "fatal"].map((lvl) => (
          <span
            key={lvl}
            onClick={() => setLevel(lvl)}
            style={{
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 4,
              fontSize: 11.5,
              background: level === lvl ? "rgba(184,241,53,.12)" : "var(--chip)",
              color: level === lvl ? "var(--accent)" : "var(--fg2)",
            }}
          >
            {lvl || "all"}
          </span>
        ))}
      </div>
      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--panel)",
          maxHeight: 480,
          overflowY: "auto",
        }}
      >
        {visible.length === 0
          ? <p style={{ color: "var(--fg2)", fontSize: 13, padding: 14 }}>Waiting for log lines…</p>
          : visible.map((line, i) => <LogRow key={i} line={line} onSelectTrace={onSelectTrace} />)}
      </div>
    </div>
  );
}

function Search({ onSelectTrace }: { onSelectTrace?: (traceId: string) => void }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const [loading, setLoading] = useState(false);

  const runSearch = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (level) params.set("level", level);
    fetch(`/api/internal/logs/search?${params.toString()}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ lines: LogLine[] }> : null))
      .then((data) => setLines(data?.lines ?? []))
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Search log content…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          style={{
            flex: 1,
            fontSize: 13,
            padding: "6px 10px",
            background: "var(--code-bg)",
            border: "1px solid var(--line2)",
            borderRadius: 4,
            color: "var(--fg)",
          }}
        />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={{
            fontSize: 13,
            padding: "6px 10px",
            background: "var(--code-bg)",
            border: "1px solid var(--line2)",
            borderRadius: 4,
            color: "var(--fg)",
          }}
        >
          {["", "trace", "debug", "info", "warn", "error", "fatal"].map((lvl) => (
            <option key={lvl} value={lvl}>{lvl || "All levels"}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={runSearch}
          style={{
            fontSize: 13,
            padding: "6px 14px",
            background: "var(--accent)",
            color: "#0A0F0A",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Search
        </button>
      </div>

      {loading
        ? null
        : lines === null
        ? <p style={{ color: "var(--fg2)", fontSize: 13 }}>Enter a query and search.</p>
        : lines.length === 0
        ? <p style={{ color: "var(--fg2)", fontSize: 13 }}>No matching log lines.</p>
        : (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {lines.map((line, i) => <LogRow key={i} line={line} onSelectTrace={onSelectTrace} />)}
          </div>
        )}
    </div>
  );
}

export interface LogsScreenProps {
  onSelectTrace?: (traceId: string) => void;
}

export function LogsScreen({ onSelectTrace }: LogsScreenProps) {
  const [tab, setTab] = useState<"live" | "search">("live");

  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          fontWeight: 600,
          margin: "0 0 20px",
        }}
      >
        Logs
      </h1>

      <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 13 }}>
        <span
          onClick={() => setTab("live")}
          style={{
            cursor: "pointer",
            color: tab === "live" ? "var(--accent)" : "var(--fg2)",
            fontWeight: tab === "live" ? 600 : 400,
          }}
        >
          Live tail
        </span>
        <span
          onClick={() => setTab("search")}
          style={{
            cursor: "pointer",
            color: tab === "search" ? "var(--accent)" : "var(--fg2)",
            fontWeight: tab === "search" ? 600 : 400,
          }}
        >
          Search
        </span>
      </div>

      {tab === "live"
        ? <LiveTail onSelectTrace={onSelectTrace} />
        : <Search onSelectTrace={onSelectTrace} />}
    </div>
  );
}
