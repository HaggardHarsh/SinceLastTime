import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { access, uuid } from "./community";
import { fail, parseBody, success } from "./errors";
import { baseUrl } from "./config";
import { hashToken, randomToken } from "./crypto";
import { invalidatePresentation } from "./presentation";
import { HISTORY_LIFETIME } from "./time";
import type { ApiRoute } from "./router";
import { lockEntry } from "./entry-locks";

function overlayInclude(communityId: string) {
  return {
    author: {
      select: {
        displayName: true,
        avatarUrl: true,
        memberships: { where: { communityId }, select: { state: true, currentEntryId: true } },
      },
    },
    reports: { where: { resolvedAt: null }, select: { id: true } },
    discussions: { select: { id: true } },
  } satisfies Prisma.StatusEntryInclude;
}
type OverlayEntry = Prisma.StatusEntryGetPayload<{ include: ReturnType<typeof overlayInclude> }>;

export function displayable(entry: OverlayEntry | null, current: boolean, now = new Date()) {
  if (
    !entry ||
    !entry.body ||
    entry.visibility !== "VISIBLE" ||
    !entry.allowOnStream ||
    entry.approvedVersion !== entry.version ||
    entry.reports.length ||
    entry.createdAt.getTime() <= now.getTime() - HISTORY_LIFETIME ||
    entry.author.memberships[0]?.state !== "ACTIVE"
  )
    return false;
  return (
    !current || (entry.expiresAt > now && entry.author.memberships[0]?.currentEntryId === entry.id)
  );
}

function presentation(entry: OverlayEntry) {
  return {
    id: entry.id,
    body: entry.body,
    emoji: entry.emoji,
    author: { displayName: entry.author.displayName, avatarUrl: entry.author.avatarUrl },
  };
}

export async function resolvePresentation(communityId: string) {
  const state = await db.overlayState.findUnique({
    where: { communityId },
    include: { community: { select: { displayName: true } } },
  });
  const empty = { revision: state?.revision ?? 0, entryId: null, entryVersion: null, card: null };
  if (!state?.entryId) return empty;
  const [entry, live] = await Promise.all([
    db.statusEntry.findUnique({
      where: { id: state.entryId },
      include: overlayInclude(communityId),
    }),
    db.segment.findFirst({ where: { communityId, state: "LIVE" }, select: { id: true } }),
  ]);
  if (
    !live ||
    !displayable(entry, true) ||
    entry!.version !== state.entryVersion ||
    entry!.communityId !== communityId
  )
    return empty;
  const context = state.contextEntryId
    ? await db.statusEntry.findUnique({
        where: { id: state.contextEntryId },
        include: overlayInclude(communityId),
      })
    : null;
  return {
    revision: state.revision,
    entryId: entry!.id,
    entryVersion: entry!.version,
    card: {
      ...presentation(entry!),
      communityName: state.community.displayName,
      previous:
        context &&
        context.communityId === communityId &&
        context.storyId === entry!.storyId &&
        displayable(context, false)
          ? presentation(context)
          : null,
    },
  };
}

export const overlayRoutes: ApiRoute[] = [
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/overlay-token$/,
    handle: async (request, [communityId]) => {
      await access(request, communityId, "owner");
      const token = randomToken();
      await db.$transaction(async (tx) => {
        await tx.overlayCredential.upsert({
          where: { communityId },
          create: { communityId, tokenHash: hashToken(token) },
          update: { tokenHash: hashToken(token), rotatedAt: new Date() },
        });
        await invalidatePresentation(tx, communityId);
      });
      return success({ url: `${baseUrl()}/overlay/${communityId}#token=${token}` });
    },
  },
  {
    method: "GET",
    pattern: /^overlay\/([^/]+)\/state$/,
    handle: async (request, [communityId]) => {
      uuid.parse(communityId);
      const authorization = request.headers.get("authorization") ?? "";
      if (!authorization.startsWith("Bearer "))
        fail(401, "OVERLAY_TOKEN_REQUIRED", "A valid overlay URL is required.");
      const credential = await db.overlayCredential.findFirst({
        where: { communityId, tokenHash: hashToken(authorization.slice(7)) },
      });
      if (!credential)
        fail(401, "OVERLAY_TOKEN_INVALID", "Generate a new overlay URL from the studio.");
      return success(await resolvePresentation(communityId));
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/segments\/([^/]+)\/show$/,
    handle: async (request, [communityId, segmentId]) => {
      const { user } = await access(request, communityId, "owner");
      uuid.parse(segmentId);
      const { entryId, expectedVersion } = await parseBody(
        request,
        z.object({ entryId: z.uuid(), expectedVersion: z.number().int().positive() }),
      );
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Segment" WHERE id = ${segmentId}::uuid FOR UPDATE`;
          const segment = await tx.segment.findFirst({
            where: { id: segmentId, communityId, state: "LIVE" },
          });
          if (!segment) fail(409, "SEGMENT_NOT_LIVE", "Start the conversation segment first.");
          await lockEntry(tx, communityId, entryId);
          const item = await tx.queueItem.findUnique({
            where: { segmentId_entryId: { segmentId, entryId } },
          });
          const entry = await tx.statusEntry.findFirst({
            where: { id: entryId, communityId },
            include: overlayInclude(communityId),
          });
          if (
            !item ||
            !entry ||
            !["PENDING", "SHOWN"].includes(item.state) ||
            !displayable(entry, true) ||
            item.entryVersion !== entry.version ||
            expectedVersion !== entry.version ||
            entry.discussions.length
          )
            fail(
              409,
              "CARD_NEEDS_REVIEW",
              "This card changed or needs approval. Review the latest update before showing it.",
            );
          const previouslyDiscussed = await tx.discussion.findUnique({
            where: { segmentId_authorId: { segmentId, authorId: entry.authorId } },
          });
          if (previouslyDiscussed)
            fail(409, "ALREADY_DISCUSSED", "Choose another community member for this segment.");
          const previous = await tx.statusEntry.findMany({
            where: {
              communityId,
              storyId: entry.storyId,
              createdAt: { lt: entry.createdAt, gt: new Date(Date.now() - HISTORY_LIFETIME) },
            },
            include: overlayInclude(communityId),
            orderBy: { createdAt: "desc" },
            take: 20,
          });
          const context = previous.find((candidate) => displayable(candidate, false));
          await tx.overlayState.upsert({
            where: { communityId },
            create: {
              communityId,
              entryId,
              entryVersion: entry.version,
              contextEntryId: context?.id ?? null,
              revision: 1,
            },
            update: {
              entryId,
              entryVersion: entry.version,
              contextEntryId: context?.id ?? null,
              revision: { increment: 1 },
            },
          });
          await tx.queueItem.update({
            where: { id: item.id },
            data: { state: "SHOWN", shownVersion: entry.version },
          });
          await tx.auditEvent.create({
            data: { communityId, actorId: user.id, action: "status.shown", targetId: entryId },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      return success({ shown: true });
    },
  },
];
