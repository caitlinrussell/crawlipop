import { expect, test } from "@playwright/test";

test("demo dashboard loads without configured auth or external services", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /example\.com SEO desk/ })).toBeVisible();
  await expect(page.getByText(/Demo preview for sc-domain:example\.com/)).toBeVisible();
  await expect(page.locator("#authEmail")).toHaveText("Signed in");
  await expect(page.getByRole("button", { name: "Sync Search Console" })).toBeEnabled();
  await expect(page.getByLabel("Data window")).toHaveValue("28");
  await expect(page.getByRole("button", { name: "Analyze behavior" })).toBeEnabled();
  await expect(page.getByLabel("Linear team")).toBeDisabled();
  await expect(page.getByLabel("Linear team")).toHaveValue("");
  await expect(page.getByRole("button", { name: /Tighten the snippet for.*meta title ideas/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "meta title ideas" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Users start activation but do not finish/ })).toBeVisible();
  await expect(page.getByText(/Test Product behavior from/)).toBeVisible();
});

test("SEO suggestions can be dismissed, hidden, shown, and restored", async ({ page }) => {
  await page.goto("/");

  const targetSuggestion = page.getByRole("button", { name: /Tighten the snippet for.*meta title ideas/ });
  await targetSuggestion.click();
  await expect(page.getByRole("heading", { name: /Tighten the snippet for.*meta title ideas/ })).toBeVisible();

  await page.locator("#detailDismiss").click();
  await expect(page.getByText(/1 dismissed item hidden for now/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Tighten the snippet for.*meta title ideas/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Show 1 dismissed" }).click();
  await expect(page.getByRole("button", { name: "Hide dismissed" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: /Tighten the snippet for.*meta title ideas/ })).toBeVisible();
  await expect(page.locator(".dismissed-state").filter({ hasText: "Dismissed" }).first()).toBeVisible();

  await page.getByRole("button", { name: /Tighten the snippet for.*meta title ideas/ }).click();
  await page.getByRole("button", { name: "Restore to queue" }).click();
  await expect(page.getByText(/1 dismissed item hidden for now/)).toHaveCount(0);
});

test("syncing in demo mode refreshes dashboard data and keeps the UI interactive", async ({ page }) => {
  await page.goto("/");

  const syncButton = page.getByRole("button", { name: "Sync Search Console" });
  const behaviorButton = page.getByRole("button", { name: "Analyze behavior" });
  const syncResponse = page.waitForResponse("**/api/sync");
  const behaviorResponse = page.waitForResponse("**/api/behavior-analysis/sync");

  await page.getByLabel("Data window").selectOption("14");
  await syncResponse;
  await behaviorResponse;

  await expect(syncButton).toBeEnabled({ timeout: 10_000 });
  await expect(behaviorButton).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /example\.com SEO desk/ })).toBeVisible();
  await expect(page.locator("#overviewMeta")).toContainText("14-day window");
  await expect(page.getByText(/suggestions in view/)).toBeVisible();
  await expect(page.locator("#behaviorMeta")).toContainText("14-day window");
});

test("public demo API endpoints return useful unauthenticated state", async ({ request }) => {
  const session = await request.get("/api/auth/session");
  expect(session.ok()).toBeTruthy();
  await expect(session).toBeOK();
  expect(await session.json()).toEqual({
    authenticated: true
  });

  const dashboard = await request.get("/api/dashboard");
  expect(dashboard.ok()).toBeTruthy();
  const payload = await dashboard.json();
  expect(payload.source).toBe("demo");
  expect(payload.siteUrl).toBe("sc-domain:example.com");
  expect([14, 28]).toContain(payload.searchConsoleWindowDays);
  expect(payload.connection.searchConsole.configured).toBe(false);
  expect(payload.connection.linear.configured).toBe(false);
  expect(payload.recommendations.length).toBeGreaterThan(0);

  const teams = await request.get("/api/linear/teams");
  await expect(teams).toBeOK();
  expect(await teams.json()).toEqual({
    configured: false,
    defaultTeamId: "",
    teams: []
  });
});
