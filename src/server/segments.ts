import { z } from "zod";
import { db } from "./db";
import { access, uuid } from "./community";
import { entryInclude, type IncludedEntry, toCard } from "./statuses";
import { fail, parseBody, success } from "./errors";
import { selectShortlist } from "./ranking";
import { invalidatePresentation } from "./presentation";
import type { ApiRoute } from "./router";

export async function candidatesFor(communityId: string, ownerId: string, segmentId?: string) {
  const memberships = await db.membership.findMany({ where: { communityId, state: "ACTIVE", userId: { not: ownerId } }, select: { currentEntryId: true } });
  const discussed = segmentId ? await db.discussion.findMany({ where: { segmentId }, select: { authorId: true } }) : [];
  return db.statusEntry.findMany({ where: { communityId, id: { in: memberships.flatMap((m) => m.currentEntryId ? [m.currentEntryId] : []) }, authorId: { notIn: discussed.map((d) => d.authorId) }, allowOnStream: true, visibility: "VISIBLE", body: { not: null }, expiresAt: { gt: new Date() }, reports: { none: { resolvedAt: null } }, discussions: { none: {} } }, include: entryInclude(communityId), orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500 });
}

function selections(entries: IncludedEntry[]) {
  return selectShortlist(entries.map((entry) => ({ id: entry.id, authorId: entry.authorId, createdAt: entry.createdAt, votes: entry.votes.length, discussionCount: entry.author.memberships[0]?.discussionCount ?? 0, lastDiscussedAt: entry.author.memberships[0]?.lastDiscussedAt ?? null, followUpDue: entry.resultFollowUps[0]?.dueAt ?? null })));
}

async function findSegment(communityId: string, id: string) {
  uuid.parse(id);
  const segment = await db.segment.findFirst({ where: { id, communityId } });
  if (!segment) fail(404, "NOT_FOUND", "This conversation segment is unavailable.");
  return segment;
}

export const segmentRoutes: ApiRoute[] = [
  { method: "GET", pattern: /^communities\/([^/]+)\/segments$/, handle: async (request, [communityId]) => {
    const { user, community } = await access(request, communityId, "moderator");
    const segment = await db.segment.findFirst({ where: { communityId, state: { in: ["DRAFT", "LIVE"] } }, include: { queue: { orderBy: { position: "asc" }, include: { entry: { include: entryInclude(communityId) } } }, discussions: { select: { id: true } } } });
    const candidates = await candidatesFor(communityId, community.ownerId, segment?.id);
    return success({ segment: segment ? { id: segment.id, state: segment.state, discussionCount: segment.discussions.length, queue: segment.queue.map((item) => ({ id: item.id, entryVersion: item.entryVersion, position: item.position, reason: item.reason, state: item.state, entry: toCard(item.entry, user.id) })) } : null, candidates: candidates.map((entry) => toCard(entry, user.id)) });
  } },
  { method: "POST", pattern: /^communities\/([^/]+)\/segments$/, handle: async (request, [communityId]) => {
    const { community } = await access(request, communityId, "moderator");
    const candidates = await candidatesFor(communityId, community.ownerId);
    const selected = selections(candidates);
    const segment = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId}::uuid FOR UPDATE`;
      const existing = await tx.segment.findFirst({ where: { communityId, state: { in: ["DRAFT", "LIVE"] } } });
      if (existing) return existing;
      return tx.segment.create({ data: { communityId, queue: { create: selected.map((selection, position) => ({ entryId: selection.entryId, entryVersion: candidates.find((e) => e.id === selection.entryId)!.version, reason: selection.reason, position })) } } });
    });
    return success({ segment });
  } },
  { method: "PUT", pattern: /^communities\/([^/]+)\/segments\/([^/]+)\/queue$/, handle: async (request, [communityId, segmentId]) => {
    const { community } = await access(request, communityId, "moderator");
    const segment = await findSegment(communityId, segmentId);
    if (segment.state === "ENDED") fail(409, "SEGMENT_ENDED", "Prepare a new conversation segment.");
    const input = await parseBody(request, z.object({ regenerate: z.boolean().optional(), entries: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() })).max(5).optional() }));
    const candidates = await candidatesFor(communityId, community.ownerId, segmentId);
    const selected = input.regenerate ? selections(candidates) : (input.entries ?? []).map((entry) => ({ entryId: entry.id, reason: "MANUAL" }));
    if (new Set(selected.map((s) => s.entryId)).size !== selected.length) fail(400, "DUPLICATE_ENTRY", "Choose each update once.");
    const selectedEntries = selected.map((s) => candidates.find((e) => e.id === s.entryId));
    if (selectedEntries.some((entry) => !entry)) fail(409, "QUEUE_CHANGED", "Some updates are no longer available. Refresh the shortlist.");
    if (new Set(selectedEntries.map((entry) => entry!.authorId)).size !== selected.length) fail(400, "DUPLICATE_AUTHOR", "Choose one update per community member.");
    if (!input.regenerate && input.entries?.some((e) => candidates.find((c) => c.id === e.id)?.version !== e.version)) fail(409, "STALE_VERSION", "An update changed. Refresh the shortlist.");
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Segment" WHERE id = ${segmentId}::uuid FOR UPDATE`;
      const fresh = await tx.segment.findUniqueOrThrow({ where: { id: segmentId } });
      if (fresh.state === "ENDED") fail(409, "SEGMENT_ENDED", "This segment has ended.");
      await tx.queueItem.deleteMany({ where: { segmentId } });
      await tx.queueItem.createMany({ data: selected.map((selection, position) => ({ segmentId, entryId: selection.entryId, entryVersion: candidates.find((e) => e.id === selection.entryId)!.version, reason: selection.reason, position })) });
      await invalidatePresentation(tx, communityId);
    });
    return success({ updated: true });
  } },
  { method: "POST", pattern: /^communities\/([^/]+)\/segments\/([^/]+)\/(start|end|clear|skip|discuss)$/, handle: async (request, [communityId, segmentId, action]) => {
    const { user } = await access(request, communityId, "owner");
    const segment = await findSegment(communityId, segmentId);
    const input = await parseBody(request, z.object({ entryId: z.uuid().optional() }));
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Segment" WHERE id = ${segmentId}::uuid FOR UPDATE`;
      const fresh = await tx.segment.findUniqueOrThrow({ where: { id: segmentId } });
      if (action === "end" && fresh.state === "ENDED") return;
      if (fresh.state === "ENDED") fail(409, "SEGMENT_ENDED", "This segment has ended.");
      if (action === "start") { await tx.segment.update({ where: { id: segmentId }, data: { state: "LIVE", startedAt: segment.startedAt ?? new Date() } }); return; }
      if (action === "end") { await tx.segment.update({ where: { id: segmentId }, data: { state: "ENDED", endedAt: new Date() } }); await invalidatePresentation(tx, communityId); return; }
      if (action === "clear") { await invalidatePresentation(tx, communityId); return; }
      if (!input.entryId) fail(400, "ENTRY_REQUIRED", "Choose an update first.");
      const item = await tx.queueItem.findUnique({ where: { segmentId_entryId: { segmentId, entryId: input.entryId } }, include: { entry: true } });
      if (!item) fail(404, "NOT_FOUND", "This update is no longer in the shortlist.");
      if (action === "skip") { await tx.queueItem.update({ where: { id: item.id }, data: { state: "SKIPPED" } }); await invalidatePresentation(tx, communityId, input.entryId); return; }
      if (fresh.state !== "LIVE") fail(409, "SEGMENT_NOT_LIVE", "Start the conversation segment first.");
      const existing = await tx.discussion.findUnique({ where: { segmentId_authorId: { segmentId, authorId: item.entry.authorId } } });
      if (existing) return;
      if (item.state !== "SHOWN") fail(409, "SHOW_FIRST", "Show the card before marking the conversation discussed.");
      await tx.discussion.create({ data: { segmentId, entryId: item.entryId, authorId: item.entry.authorId } });
      await tx.membership.update({ where: { communityId_userId: { communityId, userId: item.entry.authorId } }, data: { discussionCount: { increment: 1 }, lastDiscussedAt: new Date() } });
      await tx.queueItem.update({ where: { id: item.id }, data: { state: "DISCUSSED" } });
      await tx.notification.upsert({ where: { deduplicationKey: `discussed:${segmentId}:${item.entry.authorId}` }, create: { userId: item.entry.authorId, communityId, type: "DISCUSSED", referenceId: item.entryId, deduplicationKey: `discussed:${segmentId}:${item.entry.authorId}` }, update: {} });
      await tx.followUp.updateMany({ where: { resultEntryId: item.entryId, state: "READY" }, data: { state: "COMPLETED" } });
      await invalidatePresentation(tx, communityId, item.entryId);
      await tx.auditEvent.create({ data: { communityId, actorId: user.id, action: "status.discussed", targetId: item.entryId } });
    });
    return success({ completed: true });
  } },
];
