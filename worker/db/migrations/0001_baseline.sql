-- Constitution-mandated baseline: users keyed by stable Access JWT `sub` (never email, which can
-- change). One seed project so the app-shell's project switcher has something to render — see
-- research.md §7; real project/DSN management is out of scope for this module.

CREATE TABLE users (
  sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  idp TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO projects (id, name) VALUES ('demo', 'Demo Project');
