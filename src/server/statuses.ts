import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { access, uuid } from "./community";
import { fail, parseBody, success } from "./errors";
import { rateLimit } from "./http";
import { ACTIVE_LIFETIME, HISTORY_LIFETIME, graphemeLength, retained } from "./time";
import { checkVersion, lockEntry } from "./entry-locks";
import { decodeCursor, encodeCursor, literalSearch, searchInput } from "./pagination";
import { invalidatePresentation } from "./presentation";
import { CATEGORIES, EMOJIS, type EntryCard } from "@/shared/types";
import type { ApiRoute } from "./router";

const publicUser = { id: true, login: true, displayName: true, avatarUrl: true } as const;
export function entryInclude(communityId: string) {
  const activeVoter = {
    user: { memberships: { some: { communityId, state: "ACTIVE" as const } } },
  };
  return {
    community: { select: { ownerId: true } },
    acknowledgements: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
      include: { streamer: { select: { displayName: true } } },
    },
    author: {
      select: {
        ...publicUser,
        memberships: {
          where: { communityId },
          select: {
            currentEntryId: true,
            state: true,
            discussionCount: true,
            lastDiscussedAt: true,
          },
        },
      },
    },
    reactions: { where: activeVoter, select: { userId: true, choice: true } },
    votes: { where: activeVoter, select: { userId: true } },
    reports: { where: { resolvedAt: null }, select: { id: true } },
    reply: { include: { author: { select: publicUser } } },
    discussions: { select: { id: true } },
    sourceFollowUp: true,
    story: {
      select: {
        entries: {
          where: {
            visibility: "VISIBLE" as const,
            body: { not: null },
            createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
          },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "asc" as const },
          take: 100,
        },
      },
    },
    resultFollowUps: {
      where: { state: "READY" as const },
      select: { id: true, dueAt: true, sourceEntryId: true },
    },
  } satisfies Prisma.StatusEntryInclude;
}
export type IncludedEntry = Prisma.StatusEntryGetPayload<{
  include: ReturnType<typeof entryInclude>;
}>;

export function toCard(entry: IncludedEntry, viewerId: string): EntryCard {
  if (!entry.body || !retained(entry.createdAt))
    fail(404, "NOT_FOUND", "This update is no longer available.");
  const { memberships, ...author } = entry.author;
  const acknowledgement = entry.acknowledgements.find(
    (receipt) => receipt.contentVersion === entry.contentVersion,
  );
  return {
    id: entry.id,
    communityId: entry.communityId,
    storyId: entry.storyId,
    body: entry.body ?? "",
    emoji: entry.emoji,
    category: entry.category,
    author,
    createdAt: entry.createdAt.toISOString(),
    expiresAt: entry.expiresAt.toISOString(),
    version: entry.version,
    contentVersion: entry.contentVersion,
    approvedVersion: entry.approvedVersion,
    allowOnStream: entry.allowOnStream,
    allowFollowUp: entry.allowFollowUp,
    visibility: entry.visibility,
    isCurrent: memberships[0]?.currentEntryId === entry.id,
    discussed: entry.discussions.length > 0,
    reactionCounts: entry.reactions.reduce<Record<string, number>>((counts, reaction) => {
      counts[reaction.choice] = (counts[reaction.choice] ?? 0) + 1;
      return counts;
    }, {}),
    myReaction: entry.reactions.find((r) => r.userId === viewerId)?.choice ?? null,
    voteCount: entry.votes.length,
    myVote: entry.votes.some((v) => v.userId === viewerId),
    reportCount: entry.reports.length,
    reply: entry.reply
      ? {
          body: entry.reply.body,
          createdAt: entry.reply.createdAt.toISOString(),
          author: entry.reply.author,
        }
      : null,
    followUp: entry.sourceFollowUp
      ? {
          id: entry.sourceFollowUp.id,
          state: entry.sourceFollowUp.state,
          dueAt: entry.sourceFollowUp.dueAt.toISOString(),
        }
      : null,
    hasPrevious: entry.story.entries.some((chapter) => chapter.createdAt < entry.createdAt),
    ...(viewerId === entry.authorId || viewerId === entry.community.ownerId
      ? {
          acknowledgement: acknowledgement
            ? {
                createdAt: acknowledgement.createdAt.toISOString(),
                contentVersion: acknowledgement.contentVersion,
                streamer: acknowledgement.streamer,
              }
            : null,
        }
      : {}),
  };
}

export async function loadEntry(communityId: string, entryId: string, allowHidden = false) {
  uuid.parse(entryId);
  const entry = await db.statusEntry.findFirst({
    where: {
      id: entryId,
      communityId,
      visibility: allowHidden ? { not: "DELETED" } : "VISIBLE",
      body: { not: null },
      createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
    },
    include: entryInclude(communityId),
  });
  if (!entry || entry.author.memberships[0]?.state !== "ACTIVE")
    fail(404, "NOT_FOUND", "This update is no longer available.");
  return entry;
}

export const statusInput = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a little update first.")
    .max(4000)
    .refine((body) => graphemeLength(body) <= 280, "Keep your update to 280 characters.")
    .refine((body) => !body.includes("\0"), "Please remove invalid characters."),
  emoji: z.enum(EMOJIS).nullable().optional(),
  category: z.enum(CATEGORIES).default("Life update"),
  allowOnStream: z.boolean().default(false),
  allowFollowUp: z.boolean().default(false),
});

export const statusPatchInput = z.object({
  body: statusInput.shape.body.optional(),
  emoji: statusInput.shape.emoji,
  category: z.enum(CATEGORIES).optional(),
  allowOnStream: z.boolean().optional(),
  allowFollowUp: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
});

export async function createEntry(request: Request, communityId: string, storyId?: string) {
  const { user } = await access(request, communityId);
  const input = await parseBody(request, statusInput);
  await rateLimit(user.id, `post:${communityId}`, 5, 3_600_000);
  const entry = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "communityId" = ${communityId}::uuid AND "userId" = ${user.id}::uuid FOR UPDATE`;
      const member = await tx.membership.findUniqueOrThrow({
        where: { communityId_userId: { communityId, userId: user.id } },
      });
      if (member.state !== "ACTIVE")
        fail(403, "MEMBERSHIP_INACTIVE", "Your community access has changed. Please refresh.");
      let story;
      if (storyId) {
        uuid.parse(storyId);
        story = await tx.story.findFirst({
          where: { id: storyId, communityId, authorId: user.id },
        });
        if (!story) fail(404, "NOT_FOUND", "That story is unavailable.");
      } else {
        story = await tx.story.create({ data: { communityId, authorId: user.id } });
      }
      const created = await tx.statusEntry.create({
        data: {
          ...input,
          communityId,
          authorId: user.id,
          storyId: story.id,
          expiresAt: new Date(Date.now() + ACTIVE_LIFETIME),
        },
        include: entryInclude(communityId),
      });
      await tx.membership.update({
        where: { id: member.id },
        data: { currentEntryId: created.id },
      });
      if (member.currentEntryId)
        await invalidatePresentation(tx, communityId, member.currentEntryId);
      const followUps = await tx.followUp.findMany({
        where: {
          communityId,
          state: "SCHEDULED",
          sourceEntry: {
            storyId: story.id,
            allowFollowUp: true,
            visibility: "VISIBLE",
            createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
          },
        },
      });
      for (const followUp of followUps) {
        await tx.followUp.update({
          where: { id: followUp.id },
          data: { resultEntryId: created.id, state: "READY" },
        });
        await tx.notification.upsert({
          where: { deduplicationKey: `followup-ready:${followUp.id}` },
          create: {
            userId: followUp.requestedById,
            communityId,
            type: "FOLLOWUP_READY",
            referenceId: followUp.id,
            deduplicationKey: `followup-ready:${followUp.id}`,
          },
          update: {},
        });
      }
      return created;
    },
    { timeout: 15_000 },
  );
  const refreshed = await loadEntry(communityId, entry.id);
  return success(toCard(refreshed, user.id), 201);
}

export const statusRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/statuses$/,
    handle: async (request, [communityId]) => {
      const { user } = await access(request, communityId);
      const params = new URL(request.url).searchParams;
      const q = searchInput.parse(params.get("q") ?? "");
      const category = params.get("category")
        ? z.enum(CATEGORIES).parse(params.get("category"))
        : "";
      const scope = `feed:${communityId}:${category}:${q}`;
      const cursor = decodeCursor(params.get("cursor"), scope);
      const search = `%${literalSearch(q)}%`;
      const ids = await db.$queryRaw<{ id: string; createdAt: Date }[]>(Prisma.sql`
        SELECT e.id, e."createdAt" FROM "StatusEntry" e
        JOIN "Membership" m ON m."currentEntryId" = e.id AND m."communityId" = e."communityId" AND m."userId" = e."authorId"
        JOIN "User" u ON u.id = e."authorId"
        WHERE e."communityId" = ${communityId}::uuid AND m.state = 'ACTIVE'
          AND e.visibility = 'VISIBLE' AND e.body IS NOT NULL AND e."expiresAt" > ${new Date()}
          AND e."createdAt" > ${new Date(Date.now() - HISTORY_LIFETIME)}
          ${category ? Prisma.sql`AND e.category = ${category}` : Prisma.empty}
          ${q ? Prisma.sql`AND (e.body ILIKE ${search} OR u."displayName" ILIKE ${search} OR u.login ILIKE ${search})` : Prisma.empty}
          ${cursor ? Prisma.sql`AND (e."createdAt", e.id) < (${cursor.createdAt}, ${cursor.id}::uuid)` : Prisma.empty}
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 31`);
      const entries = await db.statusEntry.findMany({
        where: {
          id: { in: ids.slice(0, 30).map((row) => row.id) },
          visibility: "VISIBLE",
          body: { not: null },
          expiresAt: { gt: new Date() },
          createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
        },
        include: entryInclude(communityId),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return success({
        entries: entries.map((entry) => toCard(entry, user.id)),
        nextCursor: ids.length > 30 ? encodeCursor(ids[29], scope) : null,
      });
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/statuses$/,
    handle: (request, [communityId]) => createEntry(request, communityId),
  },
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)$/,
    handle: async (request, [communityId, id]) => {
      const { user } = await access(request, communityId);
      return success(toCard(await loadEntry(communityId, id), user.id));
    },
  },
  {
    method: "PATCH",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)$/,
    handle: async (request, [communityId, id]) => {
      const { user } = await access(request, communityId);
      const input = await parseBody(request, statusPatchInput);
      uuid.parse(id);
      await rateLimit(user.id, `edit:${communityId}`, 20, 3_600_000);
      const { expectedVersion, ...data } = input;
      await db.$transaction(async (tx) => {
        const { entry, member } = await lockEntry(tx, communityId, id);
        if (entry.authorId !== user.id)
          fail(403, "AUTHOR_REQUIRED", "Only the author can edit this update.");
        if (!entry.body || entry.visibility === "DELETED" || !retained(entry.createdAt))
          fail(404, "NOT_FOUND", "This update is unavailable.");
        checkVersion(entry.version, expectedVersion);
        const contentChanged =
          (input.body !== undefined && input.body !== entry.body) ||
          (input.emoji !== undefined && input.emoji !== entry.emoji) ||
          (input.category !== undefined && input.category !== entry.category);
        const discussed = await tx.discussion.count({ where: { entryId: id } });
        if (
          contentChanged &&
          (discussed || entry.expiresAt.getTime() <= Date.now() || member?.currentEntryId !== id)
        )
          fail(409, "ADD_UPDATE_INSTEAD", "Add a new update to continue this story.");
        const result = await tx.statusEntry.updateMany({
          where: {
            id,
            communityId,
            authorId: user.id,
            version: expectedVersion,
            visibility: { not: "DELETED" },
          },
          data: {
            ...data,
            version: { increment: 1 },
            ...(contentChanged ? { contentVersion: { increment: 1 } } : {}),
            approvedVersion: null,
          },
        });
        if (!result.count)
          fail(409, "STALE_VERSION", "This update changed. Refresh it and try again.");
        if (contentChanged) {
          await tx.vote.deleteMany({ where: { entryId: id } });
          await tx.reaction.deleteMany({ where: { entryId: id } });
        }
        if (input.allowFollowUp === false || contentChanged)
          await tx.followUp.updateMany({
            where: { sourceEntryId: id, state: { in: ["SCHEDULED", "READY"] } },
            data: { state: "CANCELED" },
          });
        await invalidatePresentation(tx, communityId, id);
      });
      return success(toCard(await loadEntry(communityId, id, true), user.id));
    },
  },
  {
    method: "DELETE",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)$/,
    handle: async (request, [communityId, id]) => {
      const { requireUser } = await import("./auth");
      const { deleteOwnedEntry } = await import("./owned-statuses");
      const user = await requireUser(request);
      return success(await deleteOwnedEntry(user.id, id, communityId));
    },
  },
];
