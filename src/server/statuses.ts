import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { access, uuid } from "./community";
import { fail, parseBody, success } from "./errors";
import { rateLimit } from "./http";
import { ACTIVE_LIFETIME, HISTORY_LIFETIME, graphemeLength } from "./time";
import { invalidatePresentation } from "./presentation";
import { CATEGORIES, EMOJIS, type EntryCard } from "@/shared/types";
import type { ApiRoute } from "./router";

const publicUser = { id: true, login: true, displayName: true, avatarUrl: true } as const;
export function entryInclude(communityId: string) {
  const activeVoter = { user: { memberships: { some: { communityId, state: "ACTIVE" as const } } } };
  return {
    author: { select: { ...publicUser, memberships: { where: { communityId }, select: { currentEntryId: true, state: true, discussionCount: true, lastDiscussedAt: true } } } },
    reactions: { where: activeVoter, select: { userId: true, choice: true } },
    votes: { where: activeVoter, select: { userId: true } },
    reports: { where: { resolvedAt: null }, select: { id: true } },
    reply: { include: { author: { select: publicUser } } },
    discussions: { select: { id: true } },
    sourceFollowUp: true,
    story: { select: { entries: { where: { visibility: "VISIBLE" as const, body: { not: null }, createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) } }, select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" as const }, take: 100 } } },
    resultFollowUps: { where: { state: "READY" as const }, select: { id: true, dueAt: true, sourceEntryId: true } },
  } satisfies Prisma.StatusEntryInclude;
}
export type IncludedEntry = Prisma.StatusEntryGetPayload<{ include: ReturnType<typeof entryInclude> }>;

export function toCard(entry: IncludedEntry, viewerId: string): EntryCard {
  const { memberships, ...author } = entry.author;
  return {
    id: entry.id, communityId: entry.communityId, storyId: entry.storyId, body: entry.body ?? "", emoji: entry.emoji, category: entry.category,
    author, createdAt: entry.createdAt.toISOString(), expiresAt: entry.expiresAt.toISOString(), version: entry.version, approvedVersion: entry.approvedVersion,
    allowOnStream: entry.allowOnStream, allowFollowUp: entry.allowFollowUp, visibility: entry.visibility,
    isCurrent: memberships[0]?.currentEntryId === entry.id, discussed: entry.discussions.length > 0,
    reactionCounts: entry.reactions.reduce<Record<string, number>>((counts, reaction) => { counts[reaction.choice] = (counts[reaction.choice] ?? 0) + 1; return counts; }, {}),
    myReaction: entry.reactions.find((r) => r.userId === viewerId)?.choice ?? null,
    voteCount: entry.votes.length, myVote: entry.votes.some((v) => v.userId === viewerId),
    reportCount: entry.reports.length,
    reply: entry.reply ? { body: entry.reply.body, createdAt: entry.reply.createdAt.toISOString(), author: entry.reply.author } : null,
    followUp: entry.sourceFollowUp ? { id: entry.sourceFollowUp.id, state: entry.sourceFollowUp.state, dueAt: entry.sourceFollowUp.dueAt.toISOString() } : null,
    hasPrevious: entry.story.entries.some((chapter) => chapter.createdAt < entry.createdAt),
  };
}

export async function loadEntry(communityId: string, entryId: string, allowHidden = false) {
  uuid.parse(entryId);
  const entry = await db.statusEntry.findFirst({ where: { id: entryId, communityId, visibility: allowHidden ? { not: "DELETED" } : "VISIBLE", body: { not: null }, createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) } }, include: entryInclude(communityId) });
  if (!entry || entry.author.memberships[0]?.state !== "ACTIVE") fail(404, "NOT_FOUND", "This update is no longer available.");
  return entry;
}

export const statusInput = z.object({
  body: z.string().trim().min(1, "Write a little update first.").max(4000).refine((body) => graphemeLength(body) <= 280, "Keep your update to 280 characters.").refine((body) => !body.includes("\0"), "Please remove invalid characters."),
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
  const entry = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE "communityId" = ${communityId}::uuid AND "userId" = ${user.id}::uuid FOR UPDATE`;
    const member = await tx.membership.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId: user.id } } });
    if (member.state !== "ACTIVE") fail(403, "MEMBERSHIP_INACTIVE", "Your community access has changed. Please refresh.");
    let story;
    if (storyId) {
      uuid.parse(storyId);
      story = await tx.story.findFirst({ where: { id: storyId, communityId, authorId: user.id } });
      if (!story) fail(404, "NOT_FOUND", "That story is unavailable.");
    } else {
      story = await tx.story.create({ data: { communityId, authorId: user.id } });
    }
    const created = await tx.statusEntry.create({ data: { ...input, communityId, authorId: user.id, storyId: story.id, expiresAt: new Date(Date.now() + ACTIVE_LIFETIME) }, include: entryInclude(communityId) });
    await tx.membership.update({ where: { id: member.id }, data: { currentEntryId: created.id } });
    if (member.currentEntryId) await invalidatePresentation(tx, communityId, member.currentEntryId);
    const followUps = await tx.followUp.findMany({ where: { communityId, state: "SCHEDULED", sourceEntry: { storyId: story.id, allowFollowUp: true, visibility: "VISIBLE", createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) } } } });
    for (const followUp of followUps) {
      await tx.followUp.update({ where: { id: followUp.id }, data: { resultEntryId: created.id, state: "READY" } });
      await tx.notification.upsert({ where: { deduplicationKey: `followup-ready:${followUp.id}` }, create: { userId: followUp.requestedById, communityId, type: "FOLLOWUP_READY", referenceId: followUp.id, deduplicationKey: `followup-ready:${followUp.id}` }, update: {} });
    }
    return created;
  }, { timeout: 15_000 });
  const refreshed = await loadEntry(communityId, entry.id);
  return success(toCard(refreshed, user.id), 201);
}

export const statusRoutes: ApiRoute[] = [
  { method: "GET", pattern: /^communities\/([^/]+)\/statuses$/, handle: async (request, [communityId]) => {
    const { user } = await access(request, communityId);
    const params = new URL(request.url).searchParams;
    const cursor = params.get("cursor");
    if (cursor) uuid.parse(cursor);
    const category = params.get("category");
    const memberships = await db.membership.findMany({ where: { communityId, state: "ACTIVE" }, select: { currentEntryId: true } });
    const entries = await db.statusEntry.findMany({ where: { communityId, id: { in: memberships.flatMap((m) => m.currentEntryId ? [m.currentEntryId] : []) }, visibility: "VISIBLE", body: { not: null }, expiresAt: { gt: new Date() }, ...(category ? { category: z.enum(CATEGORIES).parse(category) } : {}) }, include: entryInclude(communityId), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 31, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const hasMore = entries.length > 30;
    const page = entries.slice(0, 30);
    return success({ entries: page.map((entry) => toCard(entry, user.id)), nextCursor: hasMore ? page[29].id : null });
  } },
  { method: "POST", pattern: /^communities\/([^/]+)\/statuses$/, handle: (request, [communityId]) => createEntry(request, communityId) },
  { method: "GET", pattern: /^communities\/([^/]+)\/statuses\/([^/]+)$/, handle: async (request, [communityId, id]) => {
    const { user } = await access(request, communityId);
    return success(toCard(await loadEntry(communityId, id), user.id));
  } },
  { method: "PATCH", pattern: /^communities\/([^/]+)\/statuses\/([^/]+)$/, handle: async (request, [communityId, id]) => {
    const { user } = await access(request, communityId);
    const input = await parseBody(request, statusPatchInput);
    const entry = await loadEntry(communityId, id, true);
    if (entry.authorId !== user.id) fail(403, "AUTHOR_REQUIRED", "Only the author can edit this update.");
    const contentChanged = input.body !== undefined || input.emoji !== undefined || input.category !== undefined;
    if (contentChanged && (entry.discussions.length || entry.expiresAt.getTime() <= Date.now() || entry.author.memberships[0]?.currentEntryId !== entry.id)) fail(409, "ADD_UPDATE_INSTEAD", "Add a new update to continue this story.");
    await rateLimit(user.id, `edit:${communityId}`, 20, 3_600_000);
    const { expectedVersion, ...data } = input;
    await db.$transaction(async (tx) => {
      const result = await tx.statusEntry.updateMany({ where: { id, communityId, authorId: user.id, version: expectedVersion, visibility: { not: "DELETED" } }, data: { ...data, version: { increment: 1 }, approvedVersion: null } });
      if (!result.count) fail(409, "STALE_VERSION", "This update changed. Refresh it and try again.");
      if (contentChanged) await Promise.all([tx.vote.deleteMany({ where: { entryId: id } }), tx.reaction.deleteMany({ where: { entryId: id } })]);
      if (input.allowFollowUp === false) await tx.followUp.updateMany({ where: { sourceEntryId: id, state: { in: ["SCHEDULED", "READY"] } }, data: { state: "CANCELED" } });
      await invalidatePresentation(tx, communityId, id);
    });
    return success(toCard(await loadEntry(communityId, id, true), user.id));
  } },
  { method: "DELETE", pattern: /^communities\/([^/]+)\/statuses\/([^/]+)$/, handle: async (request, [communityId, id]) => {
    const { user } = await access(request, communityId);
    uuid.parse(id);
    const entry = await db.statusEntry.findFirst({ where: { id, communityId, authorId: user.id } });
    if (!entry) fail(404, "NOT_FOUND", "This update is unavailable.");
    await db.$transaction(async (tx) => {
      await tx.statusEntry.update({ where: { id }, data: { body: null, emoji: null, visibility: "DELETED", deletedAt: new Date(), allowOnStream: false, allowFollowUp: false, approvedVersion: null, version: { increment: 1 } } });
      await tx.membership.updateMany({ where: { communityId, currentEntryId: id }, data: { currentEntryId: null } });
      await tx.streamerReply.deleteMany({ where: { entryId: id } });
      await tx.reaction.deleteMany({ where: { entryId: id } });
      await tx.vote.deleteMany({ where: { entryId: id } });
      await tx.followUp.updateMany({ where: { OR: [{ sourceEntryId: id }, { resultEntryId: id }], state: { in: ["SCHEDULED", "READY"] } }, data: { state: "CANCELED" } });
      await invalidatePresentation(tx, communityId, id);
    });
    return success({ deleted: true });
  } },
];
