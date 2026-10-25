import { z } from "zod";
import { db } from "./db";
import { requireUser } from "./auth";
import { access, uuid } from "./community";
import { entryInclude, loadEntry, toCard } from "./statuses";
import { ApiError, fail, parseBody, success } from "./errors";
import { DAY, HISTORY_LIFETIME } from "./time";
import type { ApiRoute } from "./router";

export const followUpRoutes: ApiRoute[] = [
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)\/follow-up$/,
    handle: async (request, [communityId, entryId]) => {
      const { user } = await access(request, communityId, "owner");
      const entry = await loadEntry(communityId, entryId);
      const { days } = await parseBody(
        request,
        z.object({ days: z.number().int().min(1).max(14).default(3) }),
      );
      if (!entry.allowFollowUp || !entry.discussions.length)
        fail(
          409,
          "FOLLOWUP_UNAVAILABLE",
          "Follow-up reminders are available after a conversation when the viewer has opted in.",
        );
      const dueAt = new Date(Date.now() + days * DAY);
      if (dueAt.getTime() >= entry.createdAt.getTime() + HISTORY_LIFETIME)
        fail(
          400,
          "FOLLOWUP_TOO_LATE",
          "This story is nearly finished. Invite a fresh update instead.",
        );
      const followUp = await db.followUp.upsert({
        where: { sourceEntryId: entryId },
        create: { communityId, sourceEntryId: entryId, requestedById: user.id, dueAt },
        update: {},
      });
      return success({ followUp });
    },
  },
  {
    method: "POST",
    pattern: /^follow-ups\/([^/]+)\/dismiss$/,
    handle: async (request, [id]) => {
      const user = await requireUser(request);
      uuid.parse(id);
      const followUp = await db.followUp.findFirst({
        where: { id, sourceEntry: { authorId: user.id } },
      });
      if (!followUp) fail(404, "NOT_FOUND", "This reminder is unavailable.");
      await access(request, followUp.communityId);
      await db.followUp.updateMany({
        where: { id, state: "SCHEDULED" },
        data: { state: "DISMISSED" },
      });
      await db.notification.updateMany({
        where: { userId: user.id, referenceId: id },
        data: { readAt: new Date() },
      });
      return success({ dismissed: true });
    },
  },
  {
    method: "GET",
    pattern: /^notifications$/,
    handle: async (request) => {
      const user = await requireUser(request);
      const rows = await db.notification.findMany({
        where: { userId: user.id },
        include: { community: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const authorized = new Set<string>();
      const notifications = [];
      for (const row of rows) {
        if (!row.community || !row.communityId) continue;
        if (!authorized.has(row.communityId)) {
          try {
            await access(request, row.communityId);
            authorized.add(row.communityId);
          } catch (error) {
            if (error instanceof ApiError && [403, 404].includes(error.status)) continue;
            throw error;
          }
        }
        let entryId = row.referenceId;
        let followUpId: string | null = null;
        if (row.type === "FOLLOWUP_DUE" || row.type === "FOLLOWUP_READY") {
          const followUp = await db.followUp.findUnique({ where: { id: row.referenceId } });
          if (!followUp || ["CANCELED", "DISMISSED", "COMPLETED"].includes(followUp.state))
            continue;
          if (row.type === "FOLLOWUP_DUE" && followUp.state !== "SCHEDULED") continue;
          entryId =
            row.type === "FOLLOWUP_DUE" ? followUp.sourceEntryId : (followUp.resultEntryId ?? "");
          followUpId = followUp.id;
        }
        if (!entryId) continue;
        const entry = await db.statusEntry.findFirst({
          where: {
            id: entryId,
            communityId: row.communityId,
            visibility: "VISIBLE",
            body: { not: null },
            createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
            author: { memberships: { some: { communityId: row.communityId, state: "ACTIVE" } } },
          },
          include: entryInclude(row.communityId),
        });
        if (!entry) continue;
        notifications.push({
          id: row.id,
          type: row.type,
          createdAt: row.createdAt,
          readAt: row.readAt,
          followUpId,
          community: {
            id: row.community.id,
            slug: row.community.slug,
            displayName: row.community.displayName,
          },
          entry: toCard(entry, user.id),
        });
      }
      return success({ notifications });
    },
  },
  {
    method: "PATCH",
    pattern: /^notifications$/,
    handle: async (request) => {
      const user = await requireUser(request);
      const { ids } = await parseBody(request, z.object({ ids: z.array(z.uuid()).max(50) }));
      await db.notification.updateMany({
        where: { id: { in: ids }, userId: user.id },
        data: { readAt: new Date() },
      });
      return success({ read: true });
    },
  },
];
