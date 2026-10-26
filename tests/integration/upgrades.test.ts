import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import type { EntryCard } from "../../src/shared/types";
import { call, fixture, base } from "./fixtures";
import { hashToken, randomToken } from "../../src/server/crypto";
const suite = process.env.INTEGRATION === "1" ? describe : describe.skip;
suite("ownership, lifecycle, and community upgrades", () => {
  afterAll(() => db.$disconnect());
  it("keeps owned controls available after suspension without granting board access", async () => {
    const f = await fixture();
    try {
      const entry = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "My words remain mine",
          allowOnStream: true,
          allowFollowUp: true,
        })
      ).data;
      await call(`communities/${f.communityId}/members/${f.viewer.id}`, f.owner, "PATCH", {
        action: "suspend",
      });
      expect((await call(`communities/${f.communityId}/statuses`, f.viewer)).status).toBe(403);
      const owned = await call<{ entries: EntryCard[] }>("me/statuses", f.viewer);
      expect(owned.data.entries.some((item) => item.id === entry.id)).toBe(true);
      expect(
        (
          await call(`me/statuses/${entry.id}/preferences`, f.viewer, "PATCH", {
            expectedVersion: entry.version,
            allowOnStream: false,
            allowFollowUp: false,
          })
        ).status,
      ).toBe(200);
      expect((await call(`me/statuses/${entry.id}`, f.peer, "DELETE", {})).status).toBe(404);
      expect((await call(`me/statuses/${entry.id}`, f.viewer, "DELETE", {})).status).toBe(200);
      expect((await call(`me/statuses/${entry.id}`, f.viewer, "DELETE", {})).status).toBe(200);
      expect((await db.statusEntry.findUniqueOrThrow({ where: { id: entry.id } })).body).toBeNull();
    } finally {
      await f.cleanup();
    }
  });
  it("redacts queued text and responses past retention with cleanup stopped", async () => {
    const f = await fixture();
    try {
      const entry = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "SENSITIVE_EXPIRED_TEXT",
          allowOnStream: true,
        })
      ).data;
      await call(`communities/${f.communityId}/segments`, f.owner, "POST", {});
      await db.streamerReply.create({
        data: { entryId: entry.id, authorId: f.owner.id, body: "SENSITIVE_EXPIRED_REPLY" },
      });
      await db.statusEntry.update({
        where: { id: entry.id },
        data: {
          createdAt: new Date(Date.now() - 31 * 86400000),
          expiresAt: new Date(Date.now() - 24 * 86400000),
        },
      });
      const studio = await call<{
        segment: { queue: { entry: unknown; unavailableReason: string }[] };
      }>(`communities/${f.communityId}/segments`, f.owner);
      expect(studio.status).toBe(200);
      expect(studio.data.segment.queue[0]).toMatchObject({
        entry: null,
        unavailableReason: "EXPIRED",
      });
      expect(JSON.stringify(studio)).not.toContain("SENSITIVE_EXPIRED");
      for (const path of [
        `communities/${f.communityId}/statuses`,
        `communities/${f.communityId}/stories/${entry.storyId}`,
        `communities/${f.communityId}/members/${f.viewer.id}`,
        `communities/${f.communityId}/briefing`,
        `communities/${f.communityId}/moderation/statuses`,
      ]) {
        const response = await call(path, f.owner);
        expect(response.status).toBe(200);
        expect(JSON.stringify(response)).not.toContain("SENSITIVE_EXPIRED");
      }
      expect(JSON.stringify(await call("me/statuses", f.viewer))).not.toContain(
        "SENSITIVE_EXPIRED",
      );
      expect(
        (await call(`communities/${f.communityId}/statuses/${entry.id}`, f.viewer)).status,
      ).toBe(404);
    } finally {
      await f.cleanup();
    }
  });
  it("searches beyond loaded pages with literal matching and deletion-safe cursors", async () => {
    const f = await fixture();
    try {
      const rows = await f.seedUpdates(36);
      await db.statusEntry.update({
        where: { id: rows[0].id },
        data: { body: "Found 50%_\\ success", category: "Small win" },
      });
      const first = await call<{ entries: EntryCard[]; nextCursor: string }>(
        `communities/${f.communityId}/statuses`,
        f.viewer,
      );
      expect(first.data.entries).toHaveLength(30);
      expect(first.data.entries.some((entry) => entry.id === rows[0].id)).toBe(false);
      const search = await call<{ entries: EntryCard[] }>(
        `communities/${f.communityId}/statuses?q=${encodeURIComponent("50%_\\")}&category=Small+win`,
        f.viewer,
      );
      expect(search.data.entries.map((entry) => entry.id)).toEqual([rows[0].id]);
      await db.statusEntry.update({
        where: { id: first.data.entries[29].id },
        data: { visibility: "DELETED", body: null },
      });
      const next = await call<{ entries: EntryCard[] }>(
        `communities/${f.communityId}/statuses?cursor=${first.data.nextCursor}`,
        f.viewer,
      );
      expect(next.status).toBe(200);
      expect(next.data.entries).toHaveLength(6);
      expect(next.data.entries.some((entry) => entry.id === rows[0].id)).toBe(true);
    } finally {
      await f.cleanup();
    }
  });
  it("selects a favorite, follow-up, and never-discussed member beyond the former 500 cutoff", async () => {
    const f = await fixture();
    try {
      const rows = await f.seedUpdates(520);
      const favorite = rows[519],
        rotation = rows[518],
        follow = rows[517];
      await db.vote.createMany({
        data: [f.viewer, f.peer].map((actor) => ({ entryId: favorite.id, userId: actor.id })),
      });
      await db.membership.update({
        where: { communityId_userId: { communityId: f.communityId, userId: rotation.authorId } },
        data: { discussionCount: 0, lastDiscussedAt: null },
      });
      const source = await db.statusEntry.create({
        data: {
          communityId: f.communityId,
          authorId: follow.authorId,
          storyId: follow.storyId,
          body: "Original chapter",
          allowFollowUp: true,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      await db.followUp.create({
        data: {
          communityId: f.communityId,
          sourceEntryId: source.id,
          resultEntryId: follow.id,
          state: "READY",
          requestedById: f.owner.id,
          dueAt: new Date(),
        },
      });
      const prepared = await call(`communities/${f.communityId}/segments`, f.owner, "POST", {});
      expect(prepared.status).toBe(200);
      const studio = await call<{ segment: { queue: { reason: string; entry: EntryCard }[] } }>(
        `communities/${f.communityId}/segments`,
        f.owner,
      );
      expect(studio.data.segment.queue).toHaveLength(5);
      expect(studio.data.segment.queue).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: "COMMUNITY",
            entry: expect.objectContaining({ id: favorite.id }),
          }),
          expect.objectContaining({
            reason: "FOLLOW_UP",
            entry: expect.objectContaining({ id: follow.id }),
          }),
          expect.objectContaining({
            reason: "FIRST_TIME",
            entry: expect.objectContaining({ id: rotation.id }),
          }),
        ]),
      );
      const candidates = await call<{ entries: EntryCard[]; nextCursor: string }>(
        `communities/${f.communityId}/candidates`,
        f.owner,
      );
      expect(candidates.data.entries).toHaveLength(30);
      expect(candidates.data.nextCursor).toBeTruthy();
    } finally {
      await f.cleanup();
    }
  });
  it("keeps acknowledgements private, version-specific, idempotent, and independent of broadcast fairness", async () => {
    const f = await fixture();
    try {
      let entry = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "Community only interview update",
          allowFollowUp: true,
        })
      ).data;
      expect(
        (
          await call(
            `communities/${f.communityId}/statuses/${entry.id}/follow-up`,
            f.owner,
            "POST",
            { days: 1, expectedVersion: entry.version },
          )
        ).status,
      ).toBe(409);
      const acknowledgements = await Promise.all(
        [1, 2].map(() =>
          call(
            `communities/${f.communityId}/statuses/${entry.id}/acknowledgement`,
            f.owner,
            "PUT",
            { expectedVersion: entry.version },
          ),
        ),
      );
      expect(acknowledgements.map((result) => result.status)).toEqual([200, 200]);
      expect(await db.acknowledgement.count({ where: { entryId: entry.id } })).toBe(1);
      const member = await db.membership.findUniqueOrThrow({
        where: { communityId_userId: { communityId: f.communityId, userId: f.viewer.id } },
      });
      expect(member.discussionCount).toBe(0);
      expect(member.lastDiscussedAt).toBeNull();
      expect(member.lastAcknowledgedAt).not.toBeNull();
      const authorView = await call<EntryCard>(
        `communities/${f.communityId}/statuses/${entry.id}`,
        f.viewer,
      );
      expect(authorView.data.acknowledgement?.streamer.displayName).toBe("owner");
      const peerView = await call<EntryCard>(
        `communities/${f.communityId}/statuses/${entry.id}`,
        f.peer,
      );
      expect(peerView.data).not.toHaveProperty("acknowledgement");
      await call(`communities/${f.communityId}/members/${f.peer.id}`, f.owner, "PATCH", {
        action: "set-role",
        role: "MODERATOR",
      });
      expect(
        (await call<EntryCard>(`communities/${f.communityId}/statuses/${entry.id}`, f.peer)).data,
      ).not.toHaveProperty("acknowledgement");
      expect(
        (
          await call(
            `communities/${f.communityId}/statuses/${entry.id}/acknowledgement`,
            f.peer,
            "PUT",
            { expectedVersion: entry.version },
          )
        ).status,
      ).toBe(403);
      entry = (
        await call<EntryCard>(
          `communities/${f.communityId}/statuses/${entry.id}`,
          f.viewer,
          "PATCH",
          { allowOnStream: true, expectedVersion: entry.version },
        )
      ).data;
      expect(entry.contentVersion).toBe(1);
      expect(entry.acknowledgement).toBeTruthy();
      expect(
        (
          await call(
            `communities/${f.communityId}/statuses/${entry.id}/follow-up`,
            f.owner,
            "POST",
            { days: 1, expectedVersion: entry.version },
          )
        ).status,
      ).toBe(200);
      entry = (
        await call<EntryCard>(
          `communities/${f.communityId}/statuses/${entry.id}`,
          f.viewer,
          "PATCH",
          { body: "A changed interview update", expectedVersion: entry.version },
        )
      ).data;
      expect(entry.contentVersion).toBe(2);
      expect(entry.acknowledgement).toBeNull();
      expect(
        (await db.followUp.findUniqueOrThrow({ where: { sourceEntryId: entry.id } })).state,
      ).toBe("CANCELED");
      const notices = await call<{ notifications: { type: string }[] }>("notifications", f.viewer);
      expect(
        notices.data.notifications.filter((notice) => notice.type === "ACKNOWLEDGED"),
      ).toHaveLength(0);
      const before = await db.notification.count({ where: { userId: f.viewer.id } });
      expect(
        (
          await call(`communities/${f.communityId}/statuses/${entry.id}/reply`, f.owner, "PUT", {
            body: "Wishing you luck!",
            expectedVersion: entry.version,
          })
        ).status,
      ).toBe(200);
      expect(await db.notification.count({ where: { userId: f.viewer.id } })).toBe(before + 1);
      const current = (
        await call<EntryCard>(`communities/${f.communityId}/statuses/${entry.id}`, f.viewer)
      ).data;
      expect(current.acknowledgement?.contentVersion).toBe(2);
      expect(current.reply?.body).toBe("Wishing you luck!");
    } finally {
      await f.cleanup();
    }
  });
  it("briefs the streamer with exact retained context and completes a community-only follow-up", async () => {
    const f = await fixture();
    try {
      const source = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "Interview tomorrow. Wish me luck.",
          allowFollowUp: true,
        })
      ).data;
      expect((await call(`communities/${f.communityId}/briefing`, f.peer)).status).toBe(403);
      await call(`communities/${f.communityId}/members/${f.peer.id}`, f.owner, "PATCH", {
        action: "set-role",
        role: "MODERATOR",
      });
      expect((await call(`communities/${f.communityId}/briefing`, f.peer)).status).toBe(403);
      const first = await call<{ items: { entry: EntryCard; broadcastEligible: boolean }[] }>(
        `communities/${f.communityId}/briefing`,
        f.owner,
      );
      expect(first.data.items[0]).toMatchObject({
        entry: { id: source.id },
        broadcastEligible: false,
      });
      expect(await db.acknowledgement.count({ where: { entryId: source.id } })).toBe(0);
      expect(
        (
          await call(`communities/${f.communityId}/statuses/${source.id}/reply`, f.owner, "PUT", {
            body: "You’ve got this!",
            expectedVersion: source.version,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            `communities/${f.communityId}/statuses/${source.id}/follow-up`,
            f.owner,
            "POST",
            { days: 1, expectedVersion: source.version },
          )
        ).status,
      ).toBe(200);
      const result = (
        await call<EntryCard>(
          `communities/${f.communityId}/stories/${source.storyId}/updates`,
          f.viewer,
          "POST",
          { body: "I got the job!" },
        )
      ).data;
      const brief = await call<{
        items: {
          entry: EntryCard;
          reason: string;
          previous: { body: string };
          lastReply: { body: string };
        }[];
      }>(`communities/${f.communityId}/briefing`, f.owner);
      expect(brief.status).toBe(200);
      expect(brief.data.items[0]).toMatchObject({
        entry: { id: result.id },
        reason: "FOLLOW_UP",
        previous: { body: source.body },
        lastReply: { body: "You’ve got this!" },
      });
      await call(
        `communities/${f.communityId}/statuses/${result.id}/acknowledgement`,
        f.owner,
        "PUT",
        { expectedVersion: result.version },
      );
      expect(
        (await db.followUp.findUniqueOrThrow({ where: { sourceEntryId: source.id } })).state,
      ).toBe("COMPLETED");
      expect(
        (await call<{ items: unknown[] }>(`communities/${f.communityId}/briefing`, f.owner)).data
          .items,
      ).toHaveLength(0);
      expect(
        (
          await db.membership.findUniqueOrThrow({
            where: { communityId_userId: { communityId: f.communityId, userId: f.viewer.id } },
          })
        ).discussionCount,
      ).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
  it("paginates the briefing without marking content read", async () => {
    const f = await fixture();
    try {
      await f.seedUpdates(12);
      const page = await call<{ items: { entry: EntryCard }[]; nextCursor: string }>(
        `communities/${f.communityId}/briefing`,
        f.owner,
      );
      expect(page.data.items).toHaveLength(10);
      const next = await call<{ items: { entry: EntryCard }[] }>(
        `communities/${f.communityId}/briefing?cursor=${page.data.nextCursor}`,
        f.owner,
      );
      expect(next.data.items).toHaveLength(2);
      expect(
        new Set([...page.data.items, ...next.data.items].map((item) => item.entry.id)).size,
      ).toBe(12);
      expect(await db.acknowledgement.count({ where: { streamerId: f.owner.id } })).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
  it("keeps setup owner-only and separates public sharing tools from overlay credentials", async () => {
    const f = await fixture();
    try {
      expect((await call(`communities/${f.communityId}/setup`, f.viewer)).status).toBe(403);
      expect((await call(`communities/${f.communityId}/share-kit`, f.viewer)).status).toBe(403);
      const kit = await call<{ communityUrl: string; panelImage: string; commandResponse: string }>(
        `communities/${f.communityId}/share-kit`,
        f.owner,
      );
      expect(new URL(kit.data.communityUrl).pathname).toBe(`/c/${f.slug}`);
      expect(JSON.stringify(kit)).not.toContain("#token=");
      expect(kit.data.commandResponse).toContain(kit.data.communityUrl);
      expect(
        (
          await call(`communities/${f.communityId}/setup`, f.owner, "PATCH", {
            step: "panelAdded",
            completed: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call<{ state: { panelAddedAt: string } }>(
            `communities/${f.communityId}/setup`,
            f.owner,
          )
        ).data.state.panelAddedAt,
      ).toBeTruthy();
      expect(
        (
          await call(`communities/${f.communityId}/setup`, f.owner, "PATCH", {
            step: "panelAdded",
            completed: false,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call<{ state: { panelAddedAt: null } }>(
            `communities/${f.communityId}/setup`,
            f.owner,
          )
        ).data.state.panelAddedAt,
      ).toBeNull();
    } finally {
      await f.cleanup();
    }
  });
  it("allows former members to revoke and delete their hidden posts through author controls", async () => {
    const f = await fixture();
    try {
      const entry = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "A hidden update I still own",
          allowOnStream: true,
        })
      ).data;
      await call(`communities/${f.communityId}/statuses/${entry.id}/review`, f.owner, "POST", {
        action: "hide",
        expectedVersion: entry.version,
      });
      await db.membership.update({
        where: { communityId_userId: { communityId: f.communityId, userId: f.viewer.id } },
        data: { state: "LEFT" },
      });
      const owned = await call<{ entries: EntryCard[] }>("me/statuses", f.viewer);
      expect(owned.data.entries[0].visibility).toBe("HIDDEN");
      expect(
        (
          await call(`me/statuses/${entry.id}/preferences`, f.viewer, "PATCH", {
            expectedVersion: owned.data.entries[0].version,
            allowOnStream: false,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(`me/statuses/${entry.id}/preferences`, f.viewer, "PATCH", {
            expectedVersion: owned.data.entries[0].version + 1,
            allowOnStream: true,
          })
        ).status,
      ).toBe(400);
      expect(
        (await call(`communities/${f.communityId}/statuses/${entry.id}`, f.viewer, "DELETE", {}))
          .status,
      ).toBe(200);
      expect((await call(`communities/${f.communityId}/statuses`, f.viewer)).status).toBe(403);
    } finally {
      await f.cleanup();
    }
  });
  it("keeps selected overlay state separate from history and requires a new show after an edit", async () => {
    const f = await fixture();
    try {
      let entry = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "First presentation",
          allowOnStream: true,
        })
      ).data;
      const second = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.peer, "POST", {
          body: "Second person",
          allowOnStream: true,
        })
      ).data;
      const segment = (
        await call<{ segment: { id: string } }>(
          `communities/${f.communityId}/segments`,
          f.owner,
          "POST",
          {},
        )
      ).data.segment;
      const path = `communities/${f.communityId}/segments/${segment.id}`;
      await call(`${path}/start`, f.owner, "POST", {});
      await call(`communities/${f.communityId}/statuses/${entry.id}/review`, f.owner, "POST", {
        action: "approve",
        expectedVersion: entry.version,
      });
      await call(`${path}/show`, f.owner, "POST", {
        entryId: entry.id,
        expectedVersion: entry.version,
      });
      entry = (
        await call<EntryCard>(
          `communities/${f.communityId}/statuses/${entry.id}`,
          f.viewer,
          "PATCH",
          { body: "A revised presentation", expectedVersion: entry.version },
        )
      ).data;
      await call(`communities/${f.communityId}/statuses/${entry.id}/review`, f.owner, "POST", {
        action: "approve",
        expectedVersion: entry.version,
      });
      expect(
        (
          await call(`${path}/discuss`, f.owner, "POST", {
            entryId: entry.id,
            expectedVersion: entry.version,
          })
        ).error?.code,
      ).toBe("SHOW_FIRST");
      expect(
        (
          await call(`${path}/show`, f.owner, "POST", {
            entryId: entry.id,
            expectedVersion: entry.version,
          })
        ).status,
      ).toBe(200);
      await call(`communities/${f.communityId}/statuses/${second.id}/review`, f.owner, "POST", {
        action: "approve",
        expectedVersion: second.version,
      });
      await call(`${path}/show`, f.owner, "POST", {
        entryId: second.id,
        expectedVersion: second.version,
      });
      const studio = await call<{
        overlay: { entryId: string | null };
        segment: { queue: { entryId: string; state: string }[] };
      }>(`communities/${f.communityId}/segments`, f.owner);
      expect(studio.data.overlay.entryId).toBe(second.id);
      expect(studio.data.segment.queue.find((item) => item.entryId === entry.id)?.state).toBe(
        "SHOWN",
      );
      await call(`${path}/clear`, f.owner, "POST", {});
      expect(
        (
          await call<{ overlay: { entryId: null } }>(
            `communities/${f.communityId}/segments`,
            f.owner,
          )
        ).data.overlay.entryId,
      ).toBeNull();
      expect(
        (
          await call(`${path}/discuss`, f.owner, "POST", {
            entryId: entry.id,
            expectedVersion: entry.version,
          })
        ).status,
      ).toBe(200);
    } finally {
      await f.cleanup();
    }
  });
  it("returns canceled and expired sign-ins to safe pages with readable error signals", async () => {
    const f = await fixture();
    try {
      const state = randomToken();
      await db.oAuthAttempt.create({
        data: {
          stateHash: hashToken(state),
          returnTo: `/c/${f.slug}`,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const canceled = await fetch(
        `${base}/api/auth/twitch/callback?state=${state}&error=access_denied`,
        { redirect: "manual", headers: { Cookie: `slt_oauth=${state}` } },
      );
      const destination = new URL(canceled.headers.get("location")!);
      expect(destination.pathname).toBe(`/c/${f.slug}`);
      expect(destination.searchParams.get("signin")).toBe("canceled");
      expect(
        await db.oAuthAttempt.findUnique({ where: { stateHash: hashToken(state) } }),
      ).toBeNull();
      const expired = await fetch(`${base}/api/auth/twitch/callback?state=invalid`, {
        redirect: "manual",
      });
      const fallback = new URL(expired.headers.get("location")!);
      expect(fallback.origin).toBe(new URL(base).origin);
      expect(fallback.pathname).toBe("/communities");
      expect(fallback.searchParams.get("signin")).toBe("expired");
    } finally {
      await f.cleanup();
    }
  });
});
