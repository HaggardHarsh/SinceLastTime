import type { Prisma, StatusEntry } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { requireUser } from "./auth";
import { uuid } from "./community";
import { fail, parseBody, success } from "./errors";
import { checkVersion, lockEntry } from "./entry-locks";
import { entryInclude, toCard } from "./statuses";
import { invalidatePresentation } from "./presentation";
import { HISTORY_LIFETIME, retained } from "./time";
import { decodeCursor, encodeCursor, olderThan } from "./pagination";
import { rateLimit } from "./http";
import type { ApiRoute } from "./router";

export async function eraseEntry(
  tx: Prisma.TransactionClient,
  entry: StatusEntry,
  now: Date,
  purge = false,
) {
  const id = entry.id;
  await tx.statusEntry.update({
    where: { id },
    data: {
      body: null,
      emoji: null,
      ...(purge ? { purgedAt: now } : { visibility: "DELETED", deletedAt: now }),
      allowOnStream: false,
      allowFollowUp: false,
      approvedVersion: null,
      version: { increment: 1 },
    },
  });
  await tx.membership.updateMany({
    where: { communityId: entry.communityId, currentEntryId: id },
    data: { currentEntryId: null },
  });
  await tx.streamerReply.deleteMany({ where: { entryId: id } });
  await tx.acknowledgement.deleteMany({ where: { entryId: id } });
  await tx.reaction.deleteMany({ where: { entryId: id } });
  await tx.vote.deleteMany({ where: { entryId: id } });
  if (purge) await tx.report.deleteMany({ where: { entryId: id } });
  await tx.followUp.updateMany({
    where: {
      OR: [{ sourceEntryId: id }, { resultEntryId: id }],
      state: { in: ["SCHEDULED", "READY"] },
    },
    data: { state: "CANCELED" },
  });
  await invalidatePresentation(tx, entry.communityId, id);
}

export async function deleteOwnedEntry(userId: string, id: string, communityId?: string) {
  uuid.parse(id);
  if (communityId) uuid.parse(communityId);
  const owned = await db.statusEntry.findFirst({
    where: { id, authorId: userId, ...(communityId ? { communityId } : {}) },
  });
  if (!owned) fail(404, "NOT_FOUND", "This update is unavailable.");
  await db.$transaction(async (tx) => {
    const { entry } = await lockEntry(tx, owned.communityId, id, false);
    if (entry.authorId !== userId) fail(404, "NOT_FOUND", "This update is unavailable.");
    if (entry.visibility !== "DELETED") await eraseEntry(tx, entry, new Date());
  });
  return { deleted: true };
}

const revokeInput = z
  .object({
    expectedVersion: z.number().int().positive(),
    allowOnStream: z.literal(false).optional(),
    allowFollowUp: z.literal(false).optional(),
  })
  .refine(
    (input) => input.allowOnStream === false || input.allowFollowUp === false,
    "Choose a permission to withdraw.",
  );

export const ownedStatusRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^me\/statuses$/,
    handle: async (request) => {
      const user = await requireUser(request);
      const params = new URL(request.url).searchParams;
      const communityId = params.get("communityId");
      if (communityId) uuid.parse(communityId);
      const scope = `owned:${user.id}:${communityId ?? ""}`;
      const cursor = decodeCursor(params.get("cursor"), scope);
      const entries = await db.statusEntry.findMany({
        where: {
          authorId: user.id,
          ...(communityId ? { communityId } : {}),
          visibility: { not: "DELETED" },
          body: { not: null },
          createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
          ...olderThan(cursor),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 31,
      });
      const cards = [];
      for (const entry of entries.slice(0, 30)) {
        if (!retained(entry.createdAt)) continue;
        const loaded = await db.statusEntry.findUniqueOrThrow({
          where: { id: entry.id },
          include: { ...entryInclude(entry.communityId), community: true },
        });
        if (!loaded.body || !retained(loaded.createdAt)) continue;
        const card = toCard(loaded, user.id);
        // Former members can manage their own text, never retrieve other people's responses.
        cards.push({
          ...card,
          reply: loaded.author.memberships[0]?.state === "ACTIVE" ? card.reply : null,
          community: {
            id: loaded.community.id,
            slug: loaded.community.slug,
            displayName: loaded.community.displayName,
          },
          membershipState: loaded.author.memberships[0]?.state ?? "LEFT",
        });
      }
      const communities = await db.community.findMany({
        where: {
          entries: {
            some: {
              authorId: user.id,
              body: { not: null },
              visibility: { not: "DELETED" },
              createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
            },
          },
        },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      });
      return success({
        entries: cards,
        communities,
        nextCursor: entries.length > 30 ? encodeCursor(entries[29], scope) : null,
      });
    },
  },
  {
    method: "DELETE",
    pattern: /^me\/statuses\/([^/]+)$/,
    handle: async (request, [id]) => {
      const user = await requireUser(request);
      await rateLimit(user.id, "manage-updates", 60, 60_000);
      return success(await deleteOwnedEntry(user.id, id));
    },
  },
  {
    method: "PATCH",
    pattern: /^me\/statuses\/([^/]+)\/preferences$/,
    handle: async (request, [id]) => {
      const user = await requireUser(request);
      uuid.parse(id);
      const input = await parseBody(request, revokeInput);
      await rateLimit(user.id, "manage-updates", 60, 60_000);
      const owned = await db.statusEntry.findFirst({ where: { id, authorId: user.id } });
      if (!owned) fail(404, "NOT_FOUND", "This update is unavailable.");
      await db.$transaction(async (tx) => {
        const { entry } = await lockEntry(tx, owned.communityId, id, false);
        if (!entry.body || entry.visibility === "DELETED" || !retained(entry.createdAt))
          fail(404, "NOT_FOUND", "This update is unavailable.");
        checkVersion(entry.version, input.expectedVersion);
        const { expectedVersion: _, ...data } = input;
        await tx.statusEntry.update({
          where: { id },
          data: { ...data, version: { increment: 1 }, approvedVersion: null },
        });
        if (input.allowFollowUp === false)
          await tx.followUp.updateMany({
            where: { sourceEntryId: id, state: { in: ["SCHEDULED", "READY"] } },
            data: { state: "CANCELED" },
          });
        await invalidatePresentation(tx, entry.communityId, id);
      });
      return success({ updated: true });
    },
  },
];
