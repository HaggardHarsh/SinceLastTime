import { db } from "./db";
import { access, uuid } from "./community";
import { createEntry, entryInclude, toCard } from "./statuses";
import { HISTORY_LIFETIME } from "./time";
import { fail, success } from "./errors";
import type { ApiRoute } from "./router";

export const storyRoutes: ApiRoute[] = [
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/stories\/([^/]+)\/updates$/,
    handle: (request, [communityId, storyId]) => createEntry(request, communityId, storyId),
  },
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/stories\/([^/]+)$/,
    handle: async (request, [communityId, storyId]) => {
      const { user } = await access(request, communityId);
      uuid.parse(storyId);
      const story = await db.story.findFirst({
        where: {
          id: storyId,
          communityId,
          author: { memberships: { some: { communityId, state: "ACTIVE" } } },
        },
      });
      if (!story) fail(404, "NOT_FOUND", "This story is no longer available.");
      const entries = await db.statusEntry.findMany({
        where: {
          storyId,
          communityId,
          body: { not: null },
          visibility: "VISIBLE",
          createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
        },
        include: entryInclude(communityId),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return success({ storyId, entries: entries.map((entry) => toCard(entry, user.id)) });
    },
  },
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/members\/([^/]+)$/,
    handle: async (request, [communityId, userId]) => {
      const { user } = await access(request, communityId);
      uuid.parse(userId);
      const member = await db.membership.findFirst({
        where: { communityId, userId, state: "ACTIVE" },
        include: {
          user: { select: { id: true, login: true, displayName: true, avatarUrl: true } },
        },
      });
      if (!member) fail(404, "NOT_FOUND", "This profile is unavailable.");
      const entries = await db.statusEntry.findMany({
        where: {
          communityId,
          authorId: userId,
          body: { not: null },
          visibility: "VISIBLE",
          createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
        },
        include: entryInclude(communityId),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      });
      return success({
        user: member.user,
        role: member.role,
        joinedAt: member.joinedAt,
        entries: entries.map((entry) => toCard(entry, user.id)),
      });
    },
  },
];
