import { z } from "zod";
import { db } from "./db";
import { access } from "./community";
import { baseUrl } from "./config";
import { parseBody, success } from "./errors";
import { rateLimit } from "./http";
import type { ApiRoute } from "./router";

export function buildShareKit(slug: string) {
  const communityUrl = `${baseUrl()}/c/${encodeURIComponent(slug)}`;
  return {
    communityUrl,
    panelImage: "/share/sincelasttime-panel.png",
    panelTitle: "SinceLastTime · Our community updates",
    panelDescription: `[Share an update with our community](${communityUrl})\n\nWhat’s happened since last stream? Sharing on stream is optional.`,
    commandName: "!since",
    commandResponse: `What’s happened since last stream? Share an update with our community: ${communityUrl}. Sharing on stream is optional.`,
  };
}
const fields = {
  profileReviewed: "profileReviewedAt",
  panelAdded: "panelAddedAt",
  chatCommandAdded: "chatCommandAddedAt",
  overlayTested: "overlayTestedAt",
  dismissed: "dismissedAt",
} as const;
export const setupRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/setup$/,
    handle: async (request, [communityId]) => {
      const { community } = await access(request, communityId, "owner");
      const [state, followers, overlay] = await Promise.all([
        db.communitySetup.findUnique({ where: { communityId } }),
        db.membership.count({
          where: { communityId, state: "ACTIVE", userId: { not: community.ownerId } },
        }),
        db.overlayCredential.findUnique({ where: { communityId }, select: { communityId: true } }),
      ]);
      return success({
        state: state ?? {
          profileReviewedAt: null,
          panelAddedAt: null,
          chatCommandAddedAt: null,
          overlayTestedAt: null,
          dismissedAt: null,
        },
        facts: {
          firstFollowerJoined: followers > 0,
          followerCount: followers,
          overlayLinkGenerated: Boolean(overlay),
        },
      });
    },
  },
  {
    method: "PATCH",
    pattern: /^communities\/([^/]+)\/setup$/,
    handle: async (request, [communityId]) => {
      const { user } = await access(request, communityId, "owner");
      const input = await parseBody(
        request,
        z.object({
          step: z.enum([
            "profileReviewed",
            "panelAdded",
            "chatCommandAdded",
            "overlayTested",
            "dismissed",
          ]),
          completed: z.boolean(),
        }),
      );
      await rateLimit(user.id, "setup", 30, 60_000);
      const data = { [fields[input.step]]: input.completed ? new Date() : null };
      await db.communitySetup.upsert({
        where: { communityId },
        create: { communityId, ...data },
        update: data,
      });
      return success({ updated: true });
    },
  },
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/share-kit$/,
    handle: async (request, [communityId]) => {
      const { community } = await access(request, communityId, "owner");
      return success(buildShareKit(community.slug));
    },
  },
];
