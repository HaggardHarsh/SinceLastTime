import { test, expect } from "@playwright/test";

test("community discovery shows results, empty guidance, retry and clear", async ({ page }) => {
  let fail = false;
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        data: {
          user: { id: "viewer", login: "viewer", displayName: "Viewer", avatarUrl: "" },
          demoMode: false,
        },
      },
    }),
  );
  await page.route("**/api/communities", (route) =>
    route.fulfill({ json: { data: { communities: [], ownsCommunity: false } } }),
  );
  await page.route("**/api/communities/search?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill(
      fail
        ? { status: 503, json: { error: { message: "Search temporarily unavailable" } } }
        : {
            json: {
              data: {
                communities:
                  q === "luna"
                    ? [
                        {
                          id: "luna",
                          slug: "luna",
                          displayName: "Luna’s corner",
                          description: "Catch up together",
                          avatarUrl: "",
                          prompt: "",
                        },
                      ]
                    : [],
                hasMore: false,
              },
            },
          },
    );
  });
  await page.goto("/communities");
  const input = page.getByRole("textbox", { name: "Find a community" });
  await input.fill("https://twitch.tv/luna");
  await page.getByRole("button", { name: "Find your people" }).click();
  await expect(page.getByRole("link", { name: /Luna’s corner/ })).toHaveAttribute(
    "href",
    "/c/luna",
  );
  await input.fill("someone-new");
  await page.getByRole("button", { name: "Find your people" }).click();
  await expect(page.getByText("No matching boards yet")).toBeVisible();
  await expect(page.getByText(/ask the streamer to create/)).toBeVisible();
  fail = true;
  await input.fill("luna");
  await page.getByRole("button", { name: "Find your people" }).click();
  await expect(page.getByText("Search temporarily unavailable")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Find your people" }).click();
  await expect(page.getByRole("link", { name: /Luna’s corner/ })).toBeVisible();
  await page.getByRole("button", { name: "Back to my communities" }).click();
  await expect(page.getByText("Find your first little space")).toBeVisible();
  await expect(input).toHaveValue("");
});
