import { expect, test } from "@playwright/test";

// spec.md User Story 1: an unauthenticated visitor can read the whole marketing site via
// client-side navigation, and every page also renders correctly on a direct/deep-link visit.

test("navigates the marketing site without a full page reload and without ever prompting for login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Every instrument\./ })).toBeVisible();

  const primaryNav = page.getByRole("navigation", { name: "Primary" });

  await primaryNav.getByText("Product", { exact: true }).click();
  await expect(page).toHaveURL(/\/product$/);
  await expect(page.getByRole("heading", { name: "Six instruments, one signal chain" }))
    .toBeVisible();

  await primaryNav.getByText("Docs", { exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();

  await primaryNav.getByText("Self-hosting", { exact: true }).click();
  await expect(page).toHaveURL(/\/self-hosting$/);
  await expect(page.getByRole("heading", { name: "Your data, your infrastructure" })).toBeVisible();

  await primaryNav.getByText("Changelog", { exact: true }).click();
  await expect(page).toHaveURL(/\/changelog$/);
  await expect(page.getByRole("heading", { name: "What shipped" })).toBeVisible();

  // Never prompted for login while wandering the marketing site.
  await expect(page.getByText("Continue with Cloudflare Access")).toHaveCount(0);
});

test("renders a deep-linked marketing page directly, without going through Home first", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();
  await expect(page.getByText("Quickstart").first()).toBeVisible();
});
