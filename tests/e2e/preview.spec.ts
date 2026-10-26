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
