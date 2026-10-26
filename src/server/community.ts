import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "./db";
import { requireUser, currentUser } from "./auth";
import { demoMode } from "./config";
import { ApiError, fail, parseBody, success } from "./errors";
import { followsChannel } from "./twitch";
import { FOLLOW_CACHE_LIFETIME } from "./time";
import { rateLimit } from "./http";
import type { ApiRoute } from "./router";
import { communitySearchTerm } from "@/shared/community-search";

export const uuid = z.uuid();

export async function checkFollow(
  user: User,
  community: { id: string; broadcasterId: string; ownerId: string },
  force = false,
) {
  const membership = await db.membership.findUnique({
    where: { communityId_userId: { communityId: community.id, userId: user.id } },
  });
  if (membership?.state === "SUSPENDED")
    fail(403, "MEMBERSHIP_SUSPENDED", "Your access to this community is paused.");
  if (community.ownerId === user.id) return true;
  if (
    !force &&
    membership?.isFollower &&
    membership.followCheckedAt &&
    Date.now() - membership.followCheckedAt.getTime() < FOLLOW_CACHE_LIFETIME
  )
    return true;
  const follows =
    user.isDemo && demoMode() && community.broadcasterId.startsWith("demo-")
      ? user.login !== "visitor"
      : await followsChannel(user.id, community.broadcasterId);
  if (membership) {
    const updated = await db.membership.updateMany({
      where: { id: membership.id, state: { not: "SUSPENDED" } },
      data: {
        isFollower: follows,
        followCheckedAt: new Date(),
        ...(!follows ? { state: "LEFT" } : {}),
      },
    });
    if (!updated.count)
      fail(403, "MEMBERSHIP_SUSPENDED", "Your access to this community is paused.");
  }
  return follows;
}

export async function access(
  request: Request,
  communityId: string,
  level: "member" | "moderator" | "owner" = "member",
) {
  uuid.parse(communityId);
  const user = await requireUser(request);
  const community = await db.community.findUnique({ where: { id: communityId } });
  if (!community) fail(404, "NOT_FOUND", "This community is unavailable.");
  let membership = await db.membership.findUnique({
    where: { communityId_userId: { communityId, userId: user.id } },
  });
  if (!membership || membership.state === "LEFT")
    fail(403, "JOIN_REQUIRED", "Join this community to see its updates.");
  if (membership.state === "SUSPENDED")
    fail(403, "MEMBERSHIP_SUSPENDED", "Your access to this community is paused.");
  if (!(await checkFollow(user, community)))
    fail(403, "FOLLOW_REQUIRED", "Follow this streamer on Twitch to join their community.");
  membership = await db.membership.findUniqueOrThrow({ where: { id: membership.id } });
  if (membership.state === "SUSPENDED")
    fail(403, "MEMBERSHIP_SUSPENDED", "Your access to this community is paused.");
  if (membership.state !== "ACTIVE")
    fail(403, "JOIN_REQUIRED", "Join this community to see its updates.");
  if (level === "owner" && community.ownerId !== user.id)
    fail(403, "OWNER_REQUIRED", "Only the streamer can do that.");
  if (level === "moderator" && membership.role !== "OWNER" && membership.role !== "MODERATOR")
    fail(403, "MODERATOR_REQUIRED", "This action is available to the community team.");
  return { user, community, membership };
}

const metadata = (community: {
  id: string;
  slug: string;
  displayName: string;
  avatarUrl: string;
  description: string;
  prompt: string;
  broadcasterId: string;
}) => ({
  id: community.id,
  slug: community.slug,
  displayName: community.displayName,
  avatarUrl: community.avatarUrl,
  description: community.description,
  prompt: community.prompt,
});

export const communityRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^communities\/search$/,
    handle: async (request) => {
      const user = await requireUser(request);
      await rateLimit(user.id, "community-search", 60, 60_000);
      const raw = z
        .string()
        .trim()
        .min(1)
        .max(300)
        .parse(new URL(request.url).searchParams.get("q"));
      const term = communitySearchTerm(raw);
      if (!term)
        fail(400, "INVALID_SEARCH", "Enter a community name, Twitch username, or board link.");
      const literal = term.replace(/[\\%_]/g, "\\$&");
      const communities = await db.community.findMany({
        where: {
          ...(!demoMode() ? { owner: { isDemo: false } } : {}),
          OR: [
            { slug: { contains: literal, mode: "insensitive" } },
            { displayName: { contains: literal, mode: "insensitive" } },
          ],
        },
        orderBy: [{ slug: "asc" }, { id: "asc" }],
        take: 21,
      });
      return success({
        communities: communities.slice(0, 20).map(metadata),
        hasMore: communities.length > 20,
      });
    },
  },
  {
    method: "GET",
    pattern: /^communities$/,
    handle: async (request) => {
      const user = await requireUser(request);
      const memberships = await db.membership.findMany({
        where: { userId: user.id, state: "ACTIVE" },
        include: { community: true },
        orderBy: { joinedAt: "asc" },
      });
      return success({
        communities: memberships.map((m) => ({ ...metadata(m.community), role: m.role })),
        ownsCommunity: memberships.some((m) => m.role === "OWNER"),
      });
    },
  },
  {
    method: "POST",
    pattern: /^communities$/,
    handle: async (request) => {
      const user = await requireUser(request);
      await rateLimit(user.id, "create-community", 5, 3_600_000);
      const existing = await db.community.findUnique({ where: { ownerId: user.id } });
      if (existing) return success(metadata(existing));
      const body = await parseBody(
        request,
        z.object({ displayName: z.string().trim().min(2).max(80).optional() }),
      );
      const community = await db.community.create({
        data: {
          broadcasterId: user.twitchId,
          ownerId: user.id,
          slug: user.login.toLowerCase(),
          displayName: body.displayName ?? `${user.displayName}’s community`,
          avatarUrl: user.avatarUrl,
          memberships: {
            create: {
              userId: user.id,
              role: "OWNER",
              isFollower: true,
              followCheckedAt: new Date(),
            },
          },
        },
      });
      return success(metadata(community), 201);
    },
  },
  {
    method: "GET",
    pattern: /^communities\/lookup\/([^/]+)$/,
    handle: async (request, [slug]) => {
      const community = await db.community.findUnique({ where: { slug: slug.toLowerCase() } });
      if (!community)
        fail(
          404,
          "NOT_FOUND",
          "No SinceLastTime board exists for this username yet. The streamer needs to sign in and choose Create your community first.",
        );
      const user = await currentUser(request);
      const membership = user
        ? await db.membership.findUnique({
            where: { communityId_userId: { communityId: community.id, userId: user.id } },
          })
        : null;
      return success({
        community: metadata(community),
        membership: membership ? { state: membership.state, role: membership.role } : null,
      });
    },
  },
  {
    method: "GET",
    pattern: /^communities\/([^/]+)$/,
    handle: async (request, [id]) => {
      const { community, membership } = await access(request, id);
      const [memberCount, statusRows] = await Promise.all([
        db.membership.count({ where: { communityId: id, state: "ACTIVE" } }),
        db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM "Membership" m
          JOIN "StatusEntry" e ON e.id = m."currentEntryId" AND e."communityId" = m."communityId" AND e."authorId" = m."userId"
          WHERE m."communityId" = ${id}::uuid AND m.state = 'ACTIVE' AND e.visibility = 'VISIBLE' AND e.body IS NOT NULL AND e."expiresAt" > ${new Date()}`,
      ]);
      return success({
        community: metadata(community),
        membership,
        memberCount,
        statusCount: statusRows[0].count,
      });
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/join$/,
    handle: async (request, [id]) => {
      uuid.parse(id);
      const user = await requireUser(request);
      const community = await db.community.findUnique({ where: { id } });
      if (!community) fail(404, "NOT_FOUND", "This community is unavailable.");
      await rateLimit(user.id, `join:${id}`, 10, 60_000);
      if (!(await checkFollow(user, community, true)))
        throw new ApiError(
          403,
          "FOLLOW_REQUIRED",
          "Follow this streamer on Twitch, then check again.",
        );
      const membership = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Membership" WHERE "communityId" = ${id}::uuid AND "userId" = ${user.id}::uuid FOR UPDATE`;
        const fresh = await tx.membership.findUnique({
          where: { communityId_userId: { communityId: id, userId: user.id } },
        });
        if (fresh?.state === "SUSPENDED")
          fail(403, "MEMBERSHIP_SUSPENDED", "Your access to this community is paused.");
        return tx.membership.upsert({
          where: { communityId_userId: { communityId: id, userId: user.id } },
          create: {
            communityId: id,
            userId: user.id,
            role: community.ownerId === user.id ? "OWNER" : "VIEWER",
            state: "ACTIVE",
            isFollower: true,
            followCheckedAt: new Date(),
          },
          update: { state: "ACTIVE", isFollower: true, followCheckedAt: new Date() },
        });
      });
      return success({ membership, community: metadata(community) });
    },
  },
  {
    method: "POST",
    pattern: /^communities\/([^/]+)\/recheck-follow$/,
    handle: async (request, [id]) => {
      uuid.parse(id);
      const user = await requireUser(request);
      await rateLimit(user.id, `follow-check:${id}`, 1, 10_000);
      const community = await db.community.findUnique({ where: { id } });
      if (!community) fail(404, "NOT_FOUND", "This community is unavailable.");
      return success({ follows: await checkFollow(user, community, true) });
    },
  },
  {
    method: "PATCH",
    pattern: /^communities\/([^/]+)$/,
    handle: async (request, [id]) => {
      await access(request, id, "owner");
      const body = await parseBody(
        request,
        z.object({
          displayName: z.string().trim().min(2).max(80),
          description: z.string().trim().max(300),
          prompt: z.string().trim().min(1).max(120),
        }),
      );
      const community = await db.community.update({ where: { id }, data: body });
      return success(metadata(community));
    },
  },
];
