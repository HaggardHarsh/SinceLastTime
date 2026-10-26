import { z } from "zod";
import { db } from "./db";
import { access, uuid } from "./community";
import { entryInclude, toCard } from "./statuses";
import { fail, parseBody, success } from "./errors";
import { eligibleIds, selectLineup } from "./candidates";
import { invalidatePresentation } from "./presentation";
import type { ApiRoute } from "./router";
import { unavailableReason } from "./entry-policy";
import { resolvePresentation } from "./overlay";
import { lockEntry, checkVersion } from "./entry-locks";
import { retained } from "./time";

async function findSegment(communityId: string, id: string) {
  uuid.parse(id);
  const segment = await db.segment.findFirst({ where: { id, communityId } });
  if (!segment) fail(404, "NOT_FOUND", "This conversation segment is unavailable.");
  return segment;
}

export const segmentRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/segments$/,
    handle: async (request, [communityId]) => {
      const { user, community } = await access(request, communityId, "moderator");
      const segment = await db.segment.findFirst({
        where: { communityId, state: { in: ["DRAFT", "LIVE"] } },
        include: {
          queue: {
            orderBy: { position: "asc" },
            include: { entry: { include: entryInclude(communityId) } },
          },
          discussions: { select: { id: true } },
        },
      });
      return success({
        overlay: await resolvePresentation(communityId).then(
          ({ revision, entryId, entryVersion }) => ({ revision, entryId, entryVersion }),
        ),
        segment: segment
          ? {
              id: segment.id,
              state: segment.state,
              discussionCount: segment.discussions.length,
              queue: segment.queue.map((item) => ({
                id: item.id,
                entryVersion: item.entryVersion,
                shownVersion: item.shownVersion,
                entryId: item.entryId,
                position: item.position,
                reason: item.reason,
                state: item.state,
                unavailableReason: unavailableReason(item.entry),
                entry: unavailableReason(item.entry) ? null : toCard(item.entry, user.id),
              })),
            }
          : null,
      });
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/segments$/,
    handle: async (request, [communityId]) => {
      const { community } = await access(request, communityId, "moderator");
      const segment = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId}::uuid FOR UPDATE`;
        const existing = await tx.segment.findFirst({
          where: { communityId, state: { in: ["DRAFT", "LIVE"] } },
        });
        if (existing) return existing;
        const selected = await selectLineup(tx, communityId, community.ownerId);
        return tx.segment.create({
          data: {
            communityId,
            queue: {
              create: selected.map((selection, position) => ({
                entryId: selection.id,
                entryVersion: selection.version,
                reason: selection.reason,
                position,
              })),
            },
          },
        });
      });
      return success({ segment });
    },
  },
  {
    method: "PUT",
    pattern: /^communities\/([^/]+)\/segments\/([^/]+)\/queue$/,
    handle: async (request, [communityId, segmentId]) => {
      const { community } = await access(request, communityId, "moderator");
      const segment = await findSegment(communityId, segmentId);
      if (segment.state === "ENDED")
        fail(409, "SEGMENT_ENDED", "Prepare a new conversation segment.");
      const input = await parseBody(
        request,
        z.object({
          regenerate: z.boolean().optional(),
          entries: z
            .array(z.object({ id: z.uuid(), version: z.number().int().positive() }))
            .max(5)
            .optional(),
        }),
      );
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Segment" WHERE id = ${segmentId}::uuid FOR UPDATE`;
        const fresh = await tx.segment.findUniqueOrThrow({ where: { id: segmentId } });
        if (fresh.state === "ENDED") fail(409, "SEGMENT_ENDED", "This segment has ended.");
        const selected = input.regenerate
          ? await selectLineup(tx, communityId, community.ownerId, segmentId)
          : (input.entries ?? []).map((entry) => ({ ...entry, reason: "MANUAL" }));
        if (new Set(selected.map((entry) => entry.id)).size !== selected.length)
          fail(400, "DUPLICATE_ENTRY", "Choose each update once.");
        const candidates = await eligibleIds(
          tx,
          communityId,
          community.ownerId,
          selected.map((entry) => entry.id),
          segmentId,
        );
        if (candidates.length !== selected.length)
          fail(
            409,
            "QUEUE_CHANGED",
            "Some updates are no longer available. Refresh the shortlist.",
          );
        if (new Set(candidates.map((entry) => entry.authorId)).size !== selected.length)
          fail(400, "DUPLICATE_AUTHOR", "Choose one update per member.");
        if (
          selected.some(
            (entry) =>
              candidates.find((candidate) => candidate.id === entry.id)?.version !== entry.version,
          )
        )
          fail(409, "STALE_VERSION", "An update changed. Refresh the shortlist.");
        await tx.queueItem.deleteMany({ where: { segmentId } });
        await tx.queueItem.createMany({
          data: selected.map((selection, position) => ({
            segmentId,
            entryId: selection.id,
            entryVersion: selection.version,
            reason: selection.reason,
            position,
          })),
        });
        await invalidatePresentation(tx, communityId);
      });
      return success({ updated: true });
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/segments\/([^/]+)\/(start|end|clear|skip|discuss)$/,
    handle: async (request, [communityId, segmentId, action]) => {
      const { user } = await access(request, communityId, "owner");
      const segment = await findSegment(communityId, segmentId);
      const input = await parseBody(
        request,
        z.object({
          entryId: z.uuid().optional(),
          expectedVersion: z.number().int().positive().optional(),
        }),
      );
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Segment" WHERE id = ${segmentId}::uuid FOR UPDATE`;
        const fresh = await tx.segment.findUniqueOrThrow({ where: { id: segmentId } });
        if (action === "end" && fresh.state === "ENDED") return;
        if (fresh.state === "ENDED") fail(409, "SEGMENT_ENDED", "This segment has ended.");
        if (action === "start") {
          await tx.segment.update({
            where: { id: segmentId },
            data: { state: "LIVE", startedAt: segment.startedAt ?? new Date() },
          });
          return;
        }
        if (action === "end") {
          await tx.segment.update({
            where: { id: segmentId },
            data: { state: "ENDED", endedAt: new Date() },
          });
          await invalidatePresentation(tx, communityId);
          return;
        }
        if (action === "clear") {
          await invalidatePresentation(tx, communityId);
          return;
        }
        if (!input.entryId) fail(400, "ENTRY_REQUIRED", "Choose an update first.");
        const item = await tx.queueItem.findUnique({
          where: { segmentId_entryId: { segmentId, entryId: input.entryId } },
          include: { entry: true },
        });
        if (!item) fail(404, "NOT_FOUND", "This update is no longer in the shortlist.");
        const { entry } = await lockEntry(tx, communityId, input.entryId);
        if (action === "skip") {
          await tx.queueItem.update({ where: { id: item.id }, data: { state: "SKIPPED" } });
          await invalidatePresentation(tx, communityId, input.entryId);
          return;
        }
        if (fresh.state !== "LIVE")
          fail(409, "SEGMENT_NOT_LIVE", "Start the conversation segment first.");
        const existing = await tx.discussion.findUnique({
          where: { segmentId_authorId: { segmentId, authorId: item.entry.authorId } },
        });
        if (existing) return;
        if (!input.expectedVersion)
          fail(400, "VERSION_REQUIRED", "Refresh this card before marking it discussed.");
        checkVersion(entry.version, input.expectedVersion);
        if (!entry.body || entry.visibility !== "VISIBLE" || !retained(entry.createdAt))
          fail(409, "STATUS_UNAVAILABLE", "This update is no longer available.");
        if (
          item.state !== "SHOWN" ||
          item.shownVersion !== entry.version ||
          item.entryVersion !== entry.version
        )
          fail(409, "SHOW_FIRST", "Show the card before marking the conversation discussed.");
        await tx.discussion.create({
          data: { segmentId, entryId: item.entryId, authorId: item.entry.authorId },
        });
        await tx.membership.update({
          where: { communityId_userId: { communityId, userId: item.entry.authorId } },
          data: { discussionCount: { increment: 1 }, lastDiscussedAt: new Date() },
        });
        await tx.queueItem.update({ where: { id: item.id }, data: { state: "DISCUSSED" } });
        await tx.notification.upsert({
          where: { deduplicationKey: `discussed:${segmentId}:${item.entry.authorId}` },
          create: {
            userId: item.entry.authorId,
            communityId,
            type: "DISCUSSED",
            referenceId: item.entryId,
            deduplicationKey: `discussed:${segmentId}:${item.entry.authorId}`,
          },
          update: {},
        });
        await tx.followUp.updateMany({
          where: { resultEntryId: item.entryId, state: "READY" },
          data: { state: "COMPLETED" },
        });
        await invalidatePresentation(tx, communityId, item.entryId);
        await tx.auditEvent.create({
          data: {
            communityId,
            actorId: user.id,
            action: "status.discussed",
            targetId: item.entryId,
          },
        });
      });
      return success({ completed: true });
    },
  },
];
