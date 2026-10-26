import { test, expect } from "@playwright/test";
import { fixture, call, base, type Actor } from "../integration/fixtures";
import type { EntryCard } from "../../src/shared/types";
import { db } from "../../src/server/db";

test.afterAll(() => db.$disconnect());
async function signIn(context: import("@playwright/test").BrowserContext, actor: Actor) {
  const [name, value] = actor.cookie.split("=");
  await context.addCookies([
    { name, value, url: process.env.TEST_BASE_URL ?? "http://localhost:3000" },
  ]);
}

test("community-only acknowledgement, briefing context, and a follow-up work without a broadcast", async ({
  browser,
}) => {
  const f = await fixture();
  const ownerContext = await browser.newContext({ baseURL: base });
  const viewerContext = await browser.newContext({
    baseURL: base,
    viewport: { width: 390, height: 844 },
  });
  try {
    await signIn(ownerContext, f.owner);
    await signIn(viewerContext, f.viewer);
    const source = (
      await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
        body: "Interview tomorrow. Wish me luck.",
        allowFollowUp: true,
      })
    ).data;
    const owner = await ownerContext.newPage();
    await owner.goto(`/c/${f.slug}/briefing`);
    await expect(owner.getByRole("heading", { name: "Before you go live." })).toBeVisible();
    const card = owner.locator(".briefing-card").filter({ hasText: source.body });
    await expect(card).toBeVisible();
    expect(await db.acknowledgement.count({ where: { entryId: source.id } })).toBe(0);
    await card.getByRole("button", { name: "Acknowledge", exact: true }).click();
    const dialog = owner.getByRole("dialog");
    await dialog.getByRole("button", { name: "Invite a follow-up", exact: true }).click();
    await dialog.getByLabel("Follow-up timing").selectOption("1");
    await dialog.getByRole("button", { name: "Invite an update", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const viewer = await viewerContext.newPage();
    await viewer.goto(`/c/${f.slug}`);
    await expect(viewer.getByText(/owner read this update/)).toBeVisible();
    await viewer.goto("/notifications");
    await expect(
      viewer.getByRole("heading", { name: "Your streamer read your update." }),
    ).toBeVisible();
    await call(`communities/${f.communityId}/stories/${source.storyId}/updates`, f.viewer, "POST", {
      body: "I got the job!",
    });
    await owner.reload();
    await expect(owner.getByText("A follow-up has arrived", { exact: true })).toBeVisible();
    await expect(owner.locator(".briefing-context")).toContainText(source.body);
    await expect(owner.locator(".briefing-current")).toContainText("I got the job!");
    expect(await db.segment.count({ where: { communityId: f.communityId } })).toBe(0);
  } finally {
    await ownerContext.close();
    await viewerContext.close();
    await f.cleanup();
  }
});

test("setup produces a downloadable panel and persistent sharing confirmations", async ({
  page,
  context,
}) => {
  const f = await fixture();
  try {
    await signIn(context, f.owner);
    await page.goto(`/c/${f.slug}/setup`);
    await expect(page.getByRole("heading", { name: "A warm welcome starts here." })).toBeVisible();
    expect(await page.getByLabel("Community link", { exact: true }).inputValue()).toContain(
      `/c/${f.slug}`,
    );
    expect(await page.getByLabel("Command response", { exact: true }).inputValue()).toContain(
      "Sharing on stream is optional.",
    );
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download Twitch panel" }).click();
    expect((await download).suggestedFilename()).toBe("sincelasttime-twitch-panel.png");
    const confirmation = page.getByRole("checkbox", {
      name: "I added and tested my Twitch panel link.",
    });
    await confirmation.check();
    await expect(confirmation).toBeChecked();
    await page.reload();
    await expect(confirmation).toBeChecked();
    await page.getByRole("button", { name: "Finish setup later" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${f.slug}$`));
  } finally {
    await f.cleanup();
  }
});

test("mobile users can manage an update after suspension and sign out", async ({
  page,
  context,
}) => {
  const f = await fixture();
  try {
    const entry = (
      await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
        body: "I can still manage my own words.",
      })
    ).data;
    await call(`communities/${f.communityId}/members/${f.viewer.id}`, f.owner, "PATCH", {
      action: "suspend",
    });
    await signIn(context, f.viewer);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/communities");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Your updates" }).click();
    await expect(page.getByText(entry.body, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete update", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText(entry.body, { exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");
  } finally {
    await f.cleanup();
  }
});

test("search finds an update outside the first page", async ({ page, context }) => {
  const f = await fixture();
  try {
    const rows = await f.seedUpdates(35);
    await db.statusEntry.update({
      where: { id: rows[0].id },
      data: { body: "The oldest uniquely searchable chapter" },
    });
    await signIn(context, f.viewer);
    await page.goto(`/c/${f.slug}`);
    await expect(
      page.getByText("The oldest uniquely searchable chapter", { exact: true }),
    ).not.toBeVisible();
    await page.getByRole("textbox", { name: "Search updates" }).fill("uniquely searchable");
    await expect(
      page.getByText("The oldest uniquely searchable chapter", { exact: true }),
    ).toBeVisible();
  } finally {
    await f.cleanup();
  }
});
