import { z } from "zod";
import { db } from "./db";
import { access } from "./community";
import { loadEntry } from "./statuses";
import { fail, parseBody, success } from "./errors";
import { rateLimit } from "./http";
import { REACTIONS } from "@/shared/types";
import type { ApiRoute } from "./router";

export const interactionRoutes: ApiRoute[] = ["reaction", "vote"].flatMap((kind) => ["PUT", "DELETE"].map((method) => ({
  method,
  pattern: new RegExp(`^communities/([^/]+)/statuses/([^/]+)/${kind}$`),
  handle: async (request: Request, [communityId, id]: string[]) => {
    const { user } = await access(request, communityId);
    const entry = await loadEntry(communityId, id);
    if (entry.expiresAt.getTime() <= Date.now() || entry.author.memberships[0]?.currentEntryId !== id) fail(409, "STATUS_ARCHIVED", "This update has moved into story history.");
    await rateLimit(user.id, "interactions", 60, 60_000);
    if (kind === "vote") {
      if (method === "PUT" && (!entry.allowOnStream || entry.authorId === user.id)) fail(400, "VOTE_UNAVAILABLE", "You can nominate other members’ updates when they allow sharing on stream.");
      if (method === "PUT") await db.vote.upsert({ where: { entryId_userId: { entryId: id, userId: user.id } }, create: { entryId: id, userId: user.id }, update: {} });
      else await db.vote.deleteMany({ where: { entryId: id, userId: user.id } });
    } else {
      if (method === "PUT") {
        const { choice } = await parseBody(request, z.object({ choice: z.enum(REACTIONS) }));
        await db.reaction.upsert({ where: { entryId_userId: { entryId: id, userId: user.id } }, create: { entryId: id, userId: user.id, choice }, update: { choice } });
      } else await db.reaction.deleteMany({ where: { entryId: id, userId: user.id } });
    }
    return success({ updated: true });
  },
})));
