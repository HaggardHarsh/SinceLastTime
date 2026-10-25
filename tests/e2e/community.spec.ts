import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { db } from "../../src/server/db";

const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
// These steps follow one shared viewer/streamer journey; retry the whole journey.
test.describe.configure({ mode: "serial" });
const suffix = randomUUID().slice(0, 8);
const names = { owner: `browser_owner_${suffix}`, viewer: `browser_viewer_${suffix}` };
const createdUsers: string[] = [];
let communityId: string;
let entryId: string;
let viewerId: string;
const updateText = "The tiny thing has a next chapter. It worked!";

async function login(client: APIRequestContext, login: string) {
  const response = await client.post(`${base}/api/auth/demo`, { headers: { Origin: base }, data: { login } });
  expect(response.status()).toBe(200);
}
test.beforeAll(async ({ request }) => {
  for (const [kind, loginName] of Object.entries(names)) {
    const user = await db.user.create({ data: { twitchId: `demo-${loginName}`, login: loginName, displayName: kind === "owner" ? "Willow" : "Robin", avatarUrl: "", isDemo: true } });
    createdUsers.push(user.id); if (kind === "viewer") viewerId = user.id;
  }
  await login(request, names.owner);
  const response = await request.post(`${base}/api/communities`, { headers: { Origin: base }, data: { displayName: "Willow’s community" } });
  expect(response.status()).toBe(201);
  communityId = (await response.json()).data.id;
  await login(request, names.viewer);
  expect((await request.post(`${base}/api/communities/${communityId}/join`, { headers: { Origin: base }, data: {} })).status()).toBe(200);
});
test.afterAll(async () => {
  if (communityId) await db.community.deleteMany({ where: { id: communityId } });
  await db.user.deleteMany({ where: { id: { in: createdUsers } } });
  await db.$disconnect();
});

test("a viewer posts safely, controls consent, and adds a linked chapter", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page.request, names.viewer);
  await page.goto(`/c/${names.owner}`);
  await expect(page.getByRole("heading", { name: /Hey, Robin/ })).toBeVisible();
  await page.getByLabel("Your update").fill("Today I made <b>something tiny</b>.");
  await page.getByRole("button", { name: "Share an update", exact: true }).click();
  const card = page.locator(".status-card").filter({ hasText: "Today I made <b>something tiny</b>." });
  await expect(card).toBeVisible();
  await expect(card.locator("b")).toHaveCount(0);
  await expect(card.getByText("Community only", { exact: true })).toBeVisible();
  const feed = await page.request.get(`${base}/api/communities/${communityId}/statuses`);
  entryId = (await feed.json()).data.entries[0].id;
  await card.getByRole("button", { name: /Options for Robin/ }).click();
  await card.getByRole("button", { name: "Sharing preferences" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /Okay to share on stream/ }).check();
  await dialog.getByRole("checkbox", { name: /A follow-up is welcome/ }).check();
  await dialog.getByRole("button", { name: "Save preferences" }).click();
  await expect(dialog).not.toBeVisible();
  await card.getByRole("button", { name: /Options for Robin/ }).click();
  await card.getByRole("button", { name: "Add an update", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your update").fill(updateText);
  await dialog.getByRole("button", { name: "Community only", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /Okay to share on stream/ }).check();
  await dialog.getByRole("checkbox", { name: /A follow-up is welcome/ }).check();
  await dialog.getByRole("button", { name: "Share what happened" }).click();
  await expect(dialog).not.toBeVisible();
  const updated = page.locator(".status-card").filter({ hasText: updateText });
  await expect(updated.getByText("A little follow-up", { exact: true })).toBeVisible();
  await updated.getByRole("button", { name: "A little follow-up", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Today I made <b>something tiny</b>.", { exact: false })).toBeVisible();
  await expect(page.getByRole("dialog").getByText(updateText, { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the streamer prepares, reviews, presents, discusses, and schedules a follow-up", async ({ page, browser }) => {
  await login(page.request, names.owner);
  await page.goto(`/c/${names.owner}/studio`);
  await page.getByRole("button", { name: "Prepare a conversation" }).click();
  await expect(page.getByText("Your little lineup", { exact: false })).toBeVisible();
  await expect(page.locator(".preview-card-body")).toHaveText(updateText);
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("button", { name: "OBS setup" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Generate overlay link" }).click();
  const url = await dialog.getByLabel("Overlay URL").inputValue();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Start segment", exact: true }).click();
  await page.getByRole("button", { name: "Show on stream", exact: true }).click();
  const overlayContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const overlay = await overlayContext.newPage();
  await overlay.goto(url);
  await expect(overlay.locator(".overlay-body")).toHaveText(updateText);
  await expect(overlay.locator(".demo-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Mark discussed", exact: true }).click();
  await expect(overlay.locator(".overlay-card")).toHaveCount(0);
  const follow = page.getByRole("dialog");
  await expect(follow.getByRole("heading", { name: "Pick up the conversation later" })).toBeVisible();
  await follow.getByLabel("Follow-up timing").selectOption("1");
  await follow.getByRole("button", { name: "Invite an update" }).click();
  await expect(follow).not.toBeVisible();
  const latest = await db.statusEntry.findFirstOrThrow({ where: { communityId, body: updateText } });
  expect(await db.followUp.count({ where: { sourceEntryId: latest.id, state: "SCHEDULED" } })).toBe(1);
  await page.getByRole("button", { name: "End segment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Prepare a conversation" })).toBeVisible();
  await overlayContext.close();
});

test("a non-follower cannot open community updates", async ({ page }) => {
  await login(page.request, "visitor");
  await page.goto(`/c/${names.owner}`);
  await page.getByRole("button", { name: "Join this community", exact: true }).click();
  await expect(page.locator(".toast-error[role=alert]")).toContainText("Follow this streamer on Twitch");
  await expect(page.locator(".status-card")).toHaveCount(0);
});

test("mobile board, profile, and catch-ups work without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page.request, names.viewer);
  await page.goto(`/c/${names.owner}`);
  await expect(page.getByRole("heading", { name: /Hey, Robin/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto(`/c/${names.owner}/members/${viewerId}`);
  await expect(page.getByRole("heading", { name: "Your story so far." })).toBeVisible();
  await expect(page.locator(".status-card")).toHaveCount(2);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Your catch-ups." })).toBeVisible();
  await expect(page.getByText("You caught up on stream.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("landing and sharing guide have working navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Life happens/ })).toBeVisible();
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(page.locator("#how-it-works")).toBeInViewport();
  await page.getByRole("link", { name: "How your updates work" }).click();
  await expect(page.getByRole("heading", { name: "Who can read your updates?" })).toBeVisible();
});
