import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "../contract/support/seed-actor.ts";

// spec.md User Story 1 (checks run and report status), User Story 2 (incident-aware alerting), and
// User Story 3 (manual "test now" trigger), end to end through the actual UI — check creation
// writes audit_log (constitution Principle X), so this reuses the established seed-actor helper
// (specs/005-releases precedent) rather than Module 1's plain mintTestSession.

test("uptime check creation, manual trigger, and incident visibility across Uptime and Alerts", async ({ browser, baseURL }) => {
  await ensureContractTestActor();
  const token = await mintTestSession({
    sub: CONTRACT_TEST_ACTOR.sub,
    email: CONTRACT_TEST_ACTOR.email,
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  const uniqueName = `e2e-uptime-${crypto.randomUUID().slice(0, 8)}`;

  await page.getByText("Uptime", { exact: true }).click();
  await expect(page.getByText("Add a check")).toBeVisible();
  await page.getByPlaceholder("Name").fill(uniqueName);
  await page.getByPlaceholder("https://example.com", { exact: false }).fill("http://127.0.0.1:1");
  await page.getByRole("button", { name: "Add check" }).click();

  const checkRow = page.getByText(uniqueName);
  await expect(checkRow).toBeVisible();
  await checkRow.click();

  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  // Default failureThreshold is 3 (data-model.md) — three manual triggers against the
  // guaranteed-unreachable target should open exactly one incident (spec FR-007).
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Test this check now" }).click();
    await expect(page.getByText(/down —/)).toBeVisible();
  }

  await expect(page.getByText("open").first()).toBeVisible();

  await page.getByText("Alerts", { exact: true }).click();
  const alertRow = page.getByText(uniqueName);
  await expect(alertRow).toBeVisible();
  await expect(page.getByText("open").first()).toBeVisible();

  await alertRow.click();
  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  await context.close();
});

// Regression test for issue #102: the check-row container used `alignItems: "center"` on a flex
// row where the Name column can wrap onto multiple lines (long name, or a narrow viewport). That
// centered the single-line Type/Status/Uptime columns against the row's full (wrapped) height,
// landing them in the middle of the wrapped name text instead of aligning with its first line —
// e.g. "TCP" (Type column) reading as if it were part of the wrapped name. Reproduces the issue's
// exact 616px-wide viewport.
test("the Type column aligns with the first line of a wrapped check name, not the row's vertical middle", async ({ browser, baseURL }) => {
  await ensureContractTestActor();
  const token = await mintTestSession({
    sub: CONTRACT_TEST_ACTOR.sub,
    email: CONTRACT_TEST_ACTOR.email,
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 616, height: 743 });
  await page.goto("/");

  // Long enough to wrap onto several lines in the Name column at 616px width, so the row grows
  // much taller than the single-line Type/Status/Uptime columns. A "tcp" check (like the issue's
  // own repro, "QA TCP check 3 (Google DNS)") also keeps the Type column's text ("tcp") from
  // colliding with the "http://" scheme that'd otherwise appear in the target line below the name.
  const uniqueName = `QA row alignment regression check ${
    crypto.randomUUID().slice(0, 8)
  } with a very long descriptive name that wraps onto multiple lines at a narrow viewport width`;

  await page.getByText("Uptime", { exact: true }).click();
  // Exact match, unlike the sibling test above — run in isolation (no pre-existing checks for this
  // actor) the EmptyState's "Add a check above and FlightDeck will monitor it…" body also contains
  // the substring "Add a check", which a non-exact match resolves ambiguously.
  await expect(page.getByText("Add a check", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Name").fill(uniqueName);
  await page.locator("select").selectOption("tcp");
  await page.getByPlaceholder("host:port").fill("example.com:80");
  await page.getByRole("button", { name: "Add check" }).click();

  // The row's Name column can legitimately be squeezed to ~0px wide at this viewport (228px fixed
  // sidebar + the row's own fixed-width Type/Status/Uptime columns leave less room than 616px
  // affords), which makes every word of the long name wrap onto its own line — exactly the visual
  // collision the issue describes, and exactly why Playwright's own visibility check can't be used
  // as the "row rendered" signal here (a 0-width element reads as not-visible). Wait for it to be
  // attached to the DOM instead, which doesn't require non-zero size.
  await page.locator("span", { hasText: uniqueName }).first().waitFor({ state: "attached" });

  const rects = await page.evaluate((name) => {
    for (const row of document.querySelectorAll<HTMLElement>("div")) {
      const first = row.children[0] as HTMLElement | undefined;
      if (first && first.tagName === "SPAN" && first.textContent?.includes(name)) {
        const type = row.children[1] as HTMLElement;
        const nameRect = first.getBoundingClientRect();
        const typeRect = type.getBoundingClientRect();
        return {
          name: { y: nameRect.y, height: nameRect.height },
          type: { y: typeRect.y, height: typeRect.height },
        };
      }
    }
    return null;
  }, uniqueName);

  expect(rects).not.toBeNull();

  // Sanity check: the name actually wrapped to multiple lines, so the row is much taller than a
  // single line — otherwise this test wouldn't distinguish "center" from "flex-start" at all.
  expect(rects!.name.height).toBeGreaterThan(rects!.type.height * 2);

  // The Type column's single line of text must start at (or very near) the same vertical position
  // as the Name column's first line — not centered against the row's full wrapped height.
  expect(Math.abs(rects!.type.y - rects!.name.y)).toBeLessThanOrEqual(2);

  await context.close();
});
