import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { maintenance } from "../../src/server/maintenance";
import type { EntryCard } from "../../src/shared/types";

const suite = process.env.INTEGRATION === "1" ? describe : describe.skip;
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
type Actor = { id: string; cookie: string; login: string };
type Result<T> = { status: number; data: T; error?: { code: string } };
async function call<T = Record<string, unknown>>(
  path: string,
  actor?: Actor,
  method = "GET",
  body?: unknown,
): Promise<Result<T>> {
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(actor ? { Cookie: actor.cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { status: response.status, ...payload };
}

suite("real HTTP and PostgreSQL conversation workflow", () => {
  const suffix = randomUUID().slice(0, 8);
  const actors: Actor[] = [];
  let owner: Actor;
  let viewer: Actor;
  let peer: Actor;
  let communityId: string;
  let otherCommunityId: string;
  let entry: EntryCard;
  let segmentId: string;
  let overlayToken: string;
  let followUpId: string;
  async function createActor(kind: string) {
    const login = `test_${kind}_${suffix}`;
    const user = await db.user.create({
      data: {
        twitchId: `demo-${login}`,
        login,
        displayName: `Test ${kind}`,
        avatarUrl: "",
        isDemo: true,
      },
    });
    const response = await fetch(`${base}/api/auth/demo`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ login }),
    });
    expect(response.status).toBe(200);
    const actor = { id: user.id, login, cookie: response.headers.get("set-cookie")!.split(";")[0] };
    actors.push(actor);
    return actor;
  }
  async function overlay() {
    const response = await fetch(`${base}/api/overlay/${communityId}/state`, {
      headers: { Authorization: `Bearer ${overlayToken}` },
    });
    return { status: response.status, ...(await response.json()) } as {
      status: number;
      data: { card: { body: string } | null };
    };
  }

  beforeAll(async () => {
    owner = await createActor("owner");
    viewer = await createActor("viewer");
    peer = await createActor("peer");
    communityId = (
      await call<{ id: string }>("communities", owner, "POST", {
        displayName: `Integration ${suffix}`,
      })
    ).data.id;
    otherCommunityId = (
      await call<{ id: string }>("communities", peer, "POST", { displayName: `Other ${suffix}` })
    ).data.id;
    for (const actor of [viewer, peer])
      expect((await call(`communities/${communityId}/join`, actor, "POST", {})).status).toBe(200);
  }, 60_000);
  afterAll(async () => {
    await db.community.deleteMany({
      where: { id: { in: [communityId, otherCommunityId].filter(Boolean) } },
    });
    await db.user.deleteMany({ where: { id: { in: actors.map((a) => a.id) } } });
    await db.$disconnect();
  });

  it("enforces sign-in, follower verification, and channel isolation", async () => {
    expect((await call(`communities/${communityId}/statuses`)).status).toBe(401);
    const login = await fetch(`${base}/api/auth/demo`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ login: "visitor" }),
    });
    const visitor = {
      id: "",
      login: "visitor",
      cookie: login.headers.get("set-cookie")!.split(";")[0],
    };
    const denied = await call(`communities/${communityId}/join`, visitor, "POST", {});
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("FOLLOW_REQUIRED");
    expect((await call(`communities/${communityId}/segments`, viewer)).status).toBe(403);
    entry = (
      await call<EntryCard>(`communities/${communityId}/statuses`, viewer, "POST", {
        body: "First interview tomorrow. Wish me luck!",
        emoji: "🤞",
        allowFollowUp: true,
      })
    ).data;
    expect(entry.allowOnStream).toBe(false);
    expect((await call(`communities/${otherCommunityId}/statuses/${entry.id}`, peer)).status).toBe(
      404,
    );
    expect(
      (await call(`communities/${communityId}/statuses/${entry.id}/vote`, peer, "PUT", {})).status,
    ).toBe(400);
    const invalidOrigin = await fetch(`${base}/api/communities/${communityId}/statuses`, {
      method: "POST",
      headers: {
        Origin: "https://elsewhere.example",
        "Content-Type": "application/json",
        Cookie: viewer.cookie,
      },
      body: JSON.stringify({ body: "Rejected" }),
    });
    expect(invalidOrigin.status).toBe(403);
  });

  it("keeps votes idempotent and checks exact consent and approval at presentation", async () => {
    entry = (
      await call<EntryCard>(`communities/${communityId}/statuses/${entry.id}`, viewer, "PATCH", {
        expectedVersion: entry.version,
        allowOnStream: true,
      })
    ).data;
    expect(entry.body).toBe("First interview tomorrow. Wish me luck!");
    expect(entry.allowFollowUp).toBe(true);
    await Promise.all(
      [1, 2].map(() =>
        call(`communities/${communityId}/statuses/${entry.id}/vote`, peer, "PUT", {}),
      ),
    );
    entry = (await call<EntryCard>(`communities/${communityId}/statuses/${entry.id}`, viewer)).data;
    expect(entry.voteCount).toBe(1);
    segmentId = (
      await call<{ segment: { id: string } }>(
        `communities/${communityId}/segments`,
        owner,
        "POST",
        {},
      )
    ).data.segment.id;
    await call(`communities/${communityId}/segments/${segmentId}/start`, owner, "POST", {});
    expect(
      (
        await call(`communities/${communityId}/segments/${segmentId}/show`, owner, "POST", {
          entryId: entry.id,
          expectedVersion: entry.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(`communities/${communityId}/statuses/${entry.id}/review`, owner, "POST", {
          action: "approve",
          expectedVersion: entry.version,
        })
      ).status,
    ).toBe(200);
    const link = (
      await call<{ url: string }>(`communities/${communityId}/overlay-token`, owner, "POST", {})
    ).data.url;
    overlayToken = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
    expect(
      (
        await call(`communities/${communityId}/segments/${segmentId}/show`, owner, "POST", {
          entryId: entry.id,
          expectedVersion: entry.version,
        })
      ).status,
    ).toBe(200);
    expect((await overlay()).data.card?.body).toBe(entry.body);
    const unauthorized = await fetch(`${base}/api/communities/${communityId}/statuses`, {
      headers: { Authorization: `Bearer ${overlayToken}` },
    });
    expect(unauthorized.status).toBe(401);
    const oldVersion = entry.version;
    entry = (
      await call<EntryCard>(`communities/${communityId}/statuses/${entry.id}`, viewer, "PATCH", {
        expectedVersion: oldVersion,
        body: "Interview is tomorrow morning. Feeling ready!",
      })
    ).data;
    expect(entry.voteCount).toBe(0);
    expect(entry.approvedVersion).toBeNull();
    expect((await overlay()).data.card).toBeNull();
    expect(
      (
        await call(`communities/${communityId}/segments/${segmentId}/show`, owner, "POST", {
          entryId: entry.id,
          expectedVersion: oldVersion,
        })
      ).status,
    ).toBe(409);
    await call(`communities/${communityId}/statuses/${entry.id}/review`, owner, "POST", {
      action: "approve",
      expectedVersion: entry.version,
    });
    expect(
      (
        await call(`communities/${communityId}/segments/${segmentId}/show`, owner, "POST", {
          entryId: entry.id,
          expectedVersion: entry.version,
        })
      ).status,
    ).toBe(200);
    entry = (
      await call<EntryCard>(`communities/${communityId}/statuses/${entry.id}`, viewer, "PATCH", {
        expectedVersion: entry.version,
        allowOnStream: false,
      })
    ).data;
    expect((await overlay()).data.card).toBeNull();
  }, 30_000);

  it("records a discussion once and completes the reminder-to-new-chapter flow", async () => {
    entry = (
      await call<EntryCard>(`communities/${communityId}/statuses/${entry.id}`, viewer, "PATCH", {
        expectedVersion: entry.version,
        allowOnStream: true,
      })
    ).data;
    await call(`communities/${communityId}/statuses/${entry.id}/review`, owner, "POST", {
      action: "approve",
      expectedVersion: entry.version,
    });
    await call(`communities/${communityId}/segments/${segmentId}/show`, owner, "POST", {
      entryId: entry.id,
      expectedVersion: entry.version,
    });
    const marked = await Promise.all(
      [1, 2].map(() =>
        call(`communities/${communityId}/segments/${segmentId}/discuss`, owner, "POST", {
          entryId: entry.id,
          expectedVersion: entry.version,
        }),
      ),
    );
    expect(marked.map((r) => r.status)).toEqual([200, 200]);
    const member = await db.membership.findUniqueOrThrow({
      where: { communityId_userId: { communityId, userId: viewer.id } },
    });
    expect(member.discussionCount).toBe(1);
    expect((await overlay()).data.card).toBeNull();
    followUpId = (
      await call<{ followUp: { id: string } }>(
        `communities/${communityId}/statuses/${entry.id}/follow-up`,
        owner,
        "POST",
        { days: 1 },
      )
    ).data.followUp.id;
    await db.followUp.update({
      where: { id: followUpId },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    await maintenance();
    await maintenance();
    expect(
      await db.notification.count({ where: { deduplicationKey: `followup-due:${followUpId}` } }),
    ).toBe(1);
    const notices = (await call<{ notifications: { type: string }[] }>("notifications", viewer))
      .data.notifications;
    expect(notices.some((notice) => notice.type === "FOLLOWUP_DUE")).toBe(true);
    const update = await call<EntryCard>(
      `communities/${communityId}/stories/${entry.storyId}/updates`,
      viewer,
      "POST",
      { body: "I got the job! Starting Monday.", emoji: "🎉", allowOnStream: true },
    );
    expect(update.status).toBe(201);
    expect(update.data.storyId).toBe(entry.storyId);
    expect(update.data.hasPrevious).toBe(true);
    expect((await db.followUp.findUniqueOrThrow({ where: { id: followUpId } })).state).toBe(
      "READY",
    );
    const history = (
      await call<{ entries: EntryCard[] }>(
        `communities/${communityId}/stories/${entry.storyId}`,
        viewer,
      )
    ).data.entries;
    expect(history).toHaveLength(2);
    entry = update.data;
    await call(`communities/${communityId}/segments/${segmentId}/end`, owner, "POST", {});
    const next = (
      await call<{ segment: { id: string } }>(
        `communities/${communityId}/segments`,
        owner,
        "POST",
        {},
      )
    ).data.segment;
    const studio = (
      await call<{ segment: { queue: { entry: EntryCard; reason: string }[] } }>(
        `communities/${communityId}/segments`,
        owner,
      )
    ).data;
    expect(studio.segment.queue.find((item) => item.entry.id === entry.id)?.reason).toBe(
      "FOLLOW_UP",
    );
    segmentId = next.id;
  }, 30_000);

  it("handles moderation, suspensions, token rotation, deletion and retention", async () => {
    expect(
      (
        await call(`communities/${communityId}/statuses/${entry.id}/report`, peer, "POST", {
          reason: "Please check this test update.",
        })
      ).status,
    ).toBe(200);
    let state = (
      await call<{ entries: EntryCard[] }>(`communities/${communityId}/candidates`, owner)
    ).data;
    expect(state.entries.some((candidate) => candidate.id === entry.id)).toBe(false);
    await call(`communities/${communityId}/statuses/${entry.id}/review`, owner, "POST", {
      action: "hide",
      expectedVersion: entry.version,
    });
    expect((await call(`communities/${communityId}/statuses/${entry.id}`, viewer)).status).toBe(
      404,
    );
    const hidden = (
      await call<{ entries: EntryCard[] }>(`communities/${communityId}/moderation/statuses`, owner)
    ).data.entries;
    const hiddenEntry = hidden.find((item) => item.id === entry.id)!;
    await call(`communities/${communityId}/statuses/${entry.id}/review`, owner, "POST", {
      action: "restore",
      expectedVersion: hiddenEntry.version,
    });
    await call(`communities/${communityId}/members/${viewer.id}`, owner, "PATCH", {
      action: "suspend",
    });
    expect((await call(`communities/${communityId}/statuses`, viewer)).status).toBe(403);
    expect((await call(`communities/${communityId}/join`, viewer, "POST", {})).status).toBe(403);
    await call(`communities/${communityId}/members/${viewer.id}`, owner, "PATCH", {
      action: "reinstate",
    });
    expect((await call(`communities/${communityId}/join`, viewer, "POST", {})).status).toBe(200);
    await call(`communities/${communityId}/overlay-token`, owner, "POST", {});
    expect((await overlay()).status).toBe(401);
    expect(
      (await call(`communities/${communityId}/statuses/${entry.id}`, viewer, "DELETE", {})).status,
    ).toBe(200);
    expect((await call(`communities/${communityId}/statuses/${entry.id}`, viewer)).status).toBe(
      404,
    );
    const oldStory = await db.story.create({ data: { communityId, authorId: viewer.id } });
    const old = await db.statusEntry.create({
      data: {
        communityId,
        authorId: viewer.id,
        storyId: oldStory.id,
        body: "Old private text",
        createdAt: new Date(Date.now() - 31 * 86_400_000),
        expiresAt: new Date(Date.now() - 24 * 86_400_000),
      },
    });
    expect((await call(`communities/${communityId}/statuses/${old.id}`, viewer)).status).toBe(404);
    await maintenance();
    expect((await db.statusEntry.findUniqueOrThrow({ where: { id: old.id } })).body).toBeNull();
  }, 30_000);
});
