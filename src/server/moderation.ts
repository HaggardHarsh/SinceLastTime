import { z } from "zod";
import { db } from "./db";
import { access, uuid } from "./community";
import { entryInclude, loadEntry, statusInput, toCard } from "./statuses";
import { fail, parseBody, success } from "./errors";
import { rateLimit } from "./http";
import { invalidatePresentation } from "./presentation";
import { HISTORY_LIFETIME } from "./time";
import type { ApiRoute } from "./router";

export const moderationRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/moderation\/statuses$/,
    handle: async (request, [communityId]) => {
      const { user } = await access(request, communityId, "moderator");
      const hidden = await db.statusEntry.findMany({
        where: {
          communityId,
          visibility: "HIDDEN",
          body: { not: null },
          createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
          author: { memberships: { some: { communityId, state: "ACTIVE" } } },
        },
        include: entryInclude(communityId),
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return success({ entries: hidden.map((entry) => toCard(entry, user.id)) });
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)\/report$/,
    handle: async (request, [communityId, id]) => {
      const { user } = await access(request, communityId);
      await loadEntry(communityId, id);
      const { reason } = await parseBody(
        request,
        z.object({ reason: z.string().trim().min(3).max(500) }),
      );
      await rateLimit(user.id, "reports", 10, 86_400_000);
      const report = await db.report.upsert({
        where: { entryId_reporterId: { entryId: id, reporterId: user.id } },
        create: { entryId: id, reporterId: user.id, reason },
        update: {},
      });
      return success({ id: report.id });
    },
  },
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/reports$/,
    handle: async (request, [communityId]) => {
      const { user } = await access(request, communityId, "moderator");
      const reports = await db.report.findMany({
        where: {
          resolvedAt: null,
          entry: {
            communityId,
            body: { not: null },
            visibility: { not: "DELETED" },
            createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
          },
        },
        include: {
          reporter: { select: { displayName: true } },
          entry: { include: entryInclude(communityId) },
        },
        orderBy: { createdAt: "asc" },
      });
      return success({
        reports: reports.map((r) => ({
          id: r.id,
          reason: r.reason,
          reporter: r.reporter.displayName,
          createdAt: r.createdAt,
          entry: toCard(r.entry, user.id),
        })),
      });
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)\/review$/,
    handle: async (request, [communityId, id]) => {
      const { user } = await access(request, communityId, "moderator");
      const { action, expectedVersion } = await parseBody(
        request,
        z.object({
          action: z.enum(["approve", "hide", "restore", "resolve"]),
          expectedVersion: z.number().int().positive(),
        }),
      );
      const entry = await loadEntry(communityId, id, true);
      if (entry.version !== expectedVersion)
        fail(409, "STALE_VERSION", "This update changed. Review the latest version.");
      if (action === "approve" && (!entry.allowOnStream || entry.visibility !== "VISIBLE"))
        fail(
          409,
          "CONSENT_REQUIRED",
          "Only visible updates with broadcast permission can be approved.",
        );
      await db.$transaction(async (tx) => {
        const result = await tx.statusEntry.updateMany({
          where: { id, communityId, version: expectedVersion },
          data:
            action === "approve"
              ? { approvedVersion: expectedVersion }
              : action === "hide"
                ? { visibility: "HIDDEN", approvedVersion: null, version: { increment: 1 } }
                : action === "restore"
                  ? { visibility: "VISIBLE", approvedVersion: null, version: { increment: 1 } }
                  : {},
        });
        if (!result.count) fail(409, "STALE_VERSION", "This update changed. Please refresh.");
        if (action === "approve")
          await tx.queueItem.updateMany({
            where: {
              entryId: id,
              state: { in: ["PENDING", "SHOWN"] },
              segment: { communityId, state: { in: ["DRAFT", "LIVE"] } },
            },
            data: { entryVersion: expectedVersion },
          });
        await tx.report.updateMany({
          where: { entryId: id, resolvedAt: null },
          data: { resolvedAt: new Date(), resolvedById: user.id },
        });
        if (action === "hide" || action === "restore")
          await invalidatePresentation(tx, communityId, id);
        if (action === "hide")
          await tx.followUp.updateMany({
            where: { sourceEntryId: id, state: { in: ["SCHEDULED", "READY"] } },
            data: { state: "CANCELED" },
          });
        await tx.auditEvent.create({
          data: { communityId, actorId: user.id, action: `status.${action}`, targetId: id },
        });
      });
      return success({ reviewed: true });
    },
  },
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/members$/,
    handle: async (request, [communityId]) => {
      await access(request, communityId, "moderator");
      const members = await db.membership.findMany({
        where: { communityId },
        include: {
          user: { select: { id: true, displayName: true, login: true, avatarUrl: true } },
        },
        orderBy: { joinedAt: "asc" },
      });
      return success({
        members: members.map((m) => ({
          id: m.id,
          user: m.user,
          role: m.role,
          state: m.state,
          discussionCount: m.discussionCount,
        })),
      });
    },
  },
  {
    method: "PATCH",
    pattern: /^communities\/([^/]+)\/members\/([^/]+)$/,
    handle: async (request, [communityId, userId]) => {
      const actor = await access(request, communityId, "moderator");
      uuid.parse(userId);
      const { action, role } = await parseBody(
        request,
        z.object({
          action: z.enum(["set-role", "suspend", "reinstate"]),
          role: z.enum(["VIEWER", "MODERATOR"]).optional(),
        }),
      );
      const member = await db.membership.findUnique({
        where: { communityId_userId: { communityId, userId } },
      });
      if (!member) fail(404, "NOT_FOUND", "This member is unavailable.");
      if (member.role === "OWNER" || userId === actor.user.id)
        fail(
          403,
          "PROTECTED_ROLE",
          "The streamer’s role and your own role cannot be changed here.",
        );
      if (
        (action === "set-role" || member.role === "MODERATOR") &&
        actor.membership.role !== "OWNER"
      )
        fail(403, "OWNER_REQUIRED", "Only the streamer can change moderator access.");
      if (action === "set-role" && (!role || member.state !== "ACTIVE" || !member.isFollower))
        fail(400, "INVALID_ROLE", "Choose an active follower and a role.");
      await db.$transaction(async (tx) => {
        await tx.membership.update({
          where: { id: member.id },
          data:
            action === "set-role"
              ? { role }
              : { state: action === "suspend" ? "SUSPENDED" : "LEFT", followCheckedAt: null },
        });
        if (action === "suspend") {
          const entries = await tx.statusEntry.findMany({
            where: { communityId, authorId: userId },
            select: { id: true },
          });
          for (const entry of entries) await invalidatePresentation(tx, communityId, entry.id);
          await tx.followUp.updateMany({
            where: {
              communityId,
              sourceEntry: { authorId: userId },
              state: { in: ["SCHEDULED", "READY"] },
            },
            data: { state: "CANCELED" },
          });
        }
        await tx.auditEvent.create({
          data: {
            communityId,
            actorId: actor.user.id,
            action: `member.${action}`,
            targetId: userId,
          },
        });
      });
      return success({ updated: true });
    },
  },
  {
    method: "PUT",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)\/reply$/,
    handle: async (request, [communityId, id]) => {
      const { user } = await access(request, communityId, "owner");
      const entry = await loadEntry(communityId, id);
      const { body } = await parseBody(request, z.object({ body: statusInput.shape.body }));
      const reply = await db.streamerReply.upsert({
        where: { entryId: id },
        create: { entryId: id, authorId: user.id, body },
        update: { body },
      });
      await db.notification.upsert({
        where: { deduplicationKey: `reply:${id}` },
        create: {
          userId: entry.authorId,
          communityId,
          type: "STREAMER_REPLY",
          referenceId: entry.id,
          deduplicationKey: `reply:${id}`,
        },
        update: {},
      });
      return success({ reply });
    },
  },
];
