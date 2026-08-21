// The source-map upload endpoint's audit_log insert requires actor_sub to reference an existing
// users row (worker/db/migrations/0001_baseline.sql's FK) — true in production, where sessionAuth
// only ever succeeds for a sub that /login already upserted. mintTestSession
// (tests/e2e/support/session.ts) mints a valid session JWT without going through that upsert, so
// contract tests using a session cookie must seed the row themselves first. Memoized: one seed per
// test run is enough since the row just needs to exist.
export const CONTRACT_TEST_ACTOR = {
  sub: "contract-test",
  email: "contract@test.dev",
  idp: "test",
};

let seeded: Promise<void> | null = null;

export function ensureContractTestActor(): Promise<void> {
  if (!seeded) seeded = seedActor();
  return seeded;
}

async function seedActor(): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "npm:wrangler",
      "d1",
      "execute",
      "flightdeck-preview",
      "--local",
      "--env",
      "preview",
      "--command",
      `INSERT OR IGNORE INTO users (sub, email, idp) VALUES ('${CONTRACT_TEST_ACTOR.sub}', ` +
      `'${CONTRACT_TEST_ACTOR.email}', '${CONTRACT_TEST_ACTOR.idp}')`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stderr } = await command.output();
  if (!success) {
    throw new Error(`wrangler d1 execute (seed actor) failed: ${new TextDecoder().decode(stderr)}`);
  }
}
