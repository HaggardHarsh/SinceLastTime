import { test, expect } from "@playwright/test";

test("a fresh preview visitor can enter both demos directly from the sign-in screen", async ({
  page,
  context,
}) => {
  await page.goto("/communities?signin=unconfigured");
  await expect(
    page.getByText("Live Twitch sign-in hasn’t been connected for this preview. Try a demo below."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try viewer demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hey, Maya/ })).toBeVisible();
  await context.clearCookies();
  await page.goto("/communities");
  await page.getByRole("button", { name: "Try streamer demo", exact: true }).click();
  await expect(page).toHaveURL(/\/c\/luna\/briefing$/);
  await expect(page.getByRole("heading", { name: "Before you go live." })).toBeVisible();
});

test("the demo selector follows the active account and switches immediately", async ({ page }) => {
  await page.goto("/communities");
  const selector = page.getByRole("combobox", { name: "Demo identity" });
  await expect(selector).toHaveValue("");
  await selector.selectOption("rohan");
  await expect(page.getByRole("heading", { name: /Hey, Rohan/ })).toBeVisible();
  await expect(selector).toHaveValue("rohan");
  await page.reload();
  await expect(selector).toHaveValue("rohan");
  await selector.selectOption("olive");
  await expect(page.getByRole("heading", { name: /Hey, Olive/ })).toBeVisible();
  await expect(selector).toHaveValue("olive");
  await page.route("**/api/auth/demo", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Demo temporarily unavailable" } },
    }),
  );
  await selector.selectOption("luna");
  await expect(
    page.getByRole("alert").filter({ hasText: "Demo temporarily unavailable" }),
  ).toBeVisible();
  await expect(selector).toHaveValue("olive");
  await expect(selector).toBeEnabled();
  await expect(page.getByRole("heading", { name: /Hey, Olive/ })).toBeVisible();
});

test("a real Twitch account is not mislabeled as a demo persona", async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: "real-maya",
            login: "maya",
            displayName: "Real Maya",
            avatarUrl: "",
            isDemo: false,
          },
          demoMode: true,
        },
      },
    }),
  );
  await page.route("**/api/communities", (route) =>
    route.fulfill({ json: { data: { communities: [], ownsCommunity: false } } }),
  );
  await page.goto("/communities");
  const selector = page.getByRole("combobox", { name: "Demo identity" });
  await expect(selector).toHaveValue("");
  await expect(selector.locator("option:checked")).toHaveText("Real Maya · current account");
});
