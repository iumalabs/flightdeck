// Looks up the "demo" project's DSN key straight out of the local preview D1 instance rather than
// hardcoding it — no public endpoint exposes this (by design, it's only ever surfaced inside the
// authenticated app shell). Contract tests run against a local-only wrangler dev whose D1 state
// this suite controls, so reading it directly out of band is acceptable here — see quickstart.md's
// manual lookup command for the equivalent human step. Memoized since the lookup shells out to
// wrangler and every test in a suite needs the same key.
let dsnKeyPromise: Promise<string> | null = null;

export function getDsnKey(): Promise<string> {
  if (!dsnKeyPromise) dsnKeyPromise = lookupDsnKey();
  return dsnKeyPromise;
}

async function lookupDsnKey(): Promise<string> {
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
      // migration 0009: `projects.id` is now an INTEGER PRIMARY KEY; the demo project seeded by
      // that migration's INSERT is deterministically id 1 (the first row of a fresh table).
      "SELECT dsn_public_key FROM projects WHERE id=1",
      "--json",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stdout, stderr } = await command.output();
  if (!success) {
    throw new Error(`wrangler d1 execute failed: ${new TextDecoder().decode(stderr)}`);
  }

  const [{ results }] = JSON.parse(new TextDecoder().decode(stdout)) as [
    { results: [{ dsn_public_key: string }] },
  ];
  if (!results[0]?.dsn_public_key) {
    throw new Error("demo project has no dsn_public_key — has migration 0002 been applied?");
  }
  return results[0].dsn_public_key;
}
