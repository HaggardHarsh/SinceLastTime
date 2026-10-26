import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import type { EntryCard } from "../../src/shared/types";
import { call, fixture } from "./fixtures";
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
});
