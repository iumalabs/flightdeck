import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "../contract/support/seed-actor.ts";

// issue #72, end to end through the actual UI: Settings' "Create a project" form gains an optional
// "Base URL" field (app/shell/SettingsScreen.tsx); when filled in, project creation seeds default
// uptime checks against it, visible on the Uptime screen right away — mirroring
// multi-project-switching.spec.ts's session/context setup pattern.

test("filling in Base URL when creating a project seeds default uptime checks visible on the Uptime screen", async ({ browser, baseURL }) => {
  // A real local HTTP server (same "local listener the contract test controls" pattern
  // tests/contract/uptime-checks.spec.ts and projects-api.spec.ts already establish with
  // Deno.serve) — wrangler dev's real fetch() can reach a plain loopback listener, so this proves
  // the whole flow (form -> POST /api/internal/v1/projects -> live health probe -> seeded checks)
  // without depending on any real external network target.
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (req) => {
    const path = new URL(req.url).pathname;
    return path === "/health"
      ? new Response("ok", { status: 200 })
      : new Response("not found", { status: 404 });
  });

  try {
    const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;

    await ensureContractTestActor();
    const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
    const context = await browser.newContext();
    await context.addCookies([
      { name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" },
    ]);
    const page = await context.newPage();
    await page.goto("/");

    await page.getByText("Settings", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const projectName = `e2e-baseurl-${crypto.randomUUID().slice(0, 8)}`;
    await expect(page.getByPlaceholder("Base URL (optional)")).toBeVisible();
    await page.getByPlaceholder("Project name").fill(projectName);
    await page.getByPlaceholder("Base URL (optional)").fill(baseUrl);
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page.getByText(/^DSN: https:\/\//)).toBeVisible();

    // This environment already has other, earlier-created non-demo projects from other suites'
    // runs against the same local D1 (same caveat multi-project-switching.spec.ts documents), so
    // the switcher is always present here — switch to the just-created project before checking
    // Uptime.
    const switcher = page.getByRole("button", { name: "Switch project" });
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("option", { name: projectName }).click();

    await page.getByText("Uptime", { exact: true }).click();
    // The check row renders name and target in the same element (name text node followed by a
    // nested target <div>), so an exact "Root"/"Health" match never hits — assert on the row's
    // combined leading text instead, plus the target on its own (a separate element, matches
    // exactly).
    await expect(page.getByText(/^Root/)).toBeVisible();
    await expect(page.getByText(baseUrl, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Health/)).toBeVisible();
    await expect(page.getByText(`${baseUrl}/health`, { exact: true })).toBeVisible();

    await context.close();
  } finally {
    await server.shutdown();
  }
});
