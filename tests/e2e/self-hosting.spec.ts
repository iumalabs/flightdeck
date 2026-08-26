import { expect, test } from "@playwright/test";

// Regression test for issue #86: the self-hosting page used to present a Docker Compose card
// (pulling a nonexistent `ghcr.io/iumalabs/flightdeck` image) and a Kubernetes/Helm card
// (`helm repo add ... https://charts.iuma.dev`) alongside the real Cloudflare path — neither
// Docker image nor Helm chart has ever existed. Those two paths were removed outright (not
// marked "coming soon"); only the real Cloudflare path remains.

test("self-hosting page presents only the real Cloudflare deployment path", async ({ page }) => {
  await page.goto("/self-hosting");
  await expect(page.getByRole("heading", { name: "Your data, your infrastructure" }))
    .toBeVisible();

  // The one real, working path is still here.
  await expect(page.getByText("Cloudflare", { exact: true })).toBeVisible();
  await expect(page.getByText("wrangler deploy", { exact: false })).toBeVisible();

  // Neither removed path's copy is present anywhere on the page.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("Docker Compose");
  expect(bodyText).not.toContain("Kubernetes");
  expect(bodyText).not.toContain("docker-compose");
  expect(bodyText).not.toContain("helm repo add");
  expect(bodyText).not.toContain("ghcr.io");
});
