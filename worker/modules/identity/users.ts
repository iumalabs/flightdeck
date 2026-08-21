export interface Operator {
  sub: string;
  email: string;
  role: string;
}

// Insert-or-update keyed on `sub` (constitution: never key on email, which can change). First
// call for a `sub` creates the row with default role/timestamps; every call updates `email` and
// `last_seen_at` — this is both the first-login auto-provision (spec FR-007) and the
// returning-user recognition (spec FR-008) in one operation.
export async function upsertUser(
  db: D1Database,
  identity: { sub: string; email: string; idp: string },
): Promise<Operator> {
  await db
    .prepare(
      `INSERT INTO users (sub, email, idp)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(sub) DO UPDATE SET email = ?2, last_seen_at = datetime('now')`,
    )
    .bind(identity.sub, identity.email, identity.idp)
    .run();

  const row = await db
    .prepare(`SELECT sub, email, role FROM users WHERE sub = ?1`)
    .bind(identity.sub)
    .first<Operator>();

  if (!row) {
    throw new Error(`upsertUser: row missing immediately after upsert for sub=${identity.sub}`);
  }

  return row;
}
