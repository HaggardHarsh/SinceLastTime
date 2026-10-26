import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { access } from "./community";
import { entryInclude, toCard } from "./statuses";
import { eligibleIds } from "./candidates";
import { unavailableReason } from "./entry-policy";
import { HISTORY_LIFETIME } from "./time";
import { fail, success } from "./errors";
import type { ApiRoute } from "./router";

const cursorInput = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  last: z.iso.datetime().nullable(),
  ready: z.boolean(),
  scope: z.string(),
});
type BriefRow = {
  id: string;
  storyId: string;
  createdAt: Date;
  lastContactAt: Date | null;
  ready: boolean;
};
export const briefingRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/briefing$/,
    handle: async (request, [communityId]) => {
      const { user, community } = await access(request, communityId, "owner");
      const value = new URL(request.url).searchParams.get("cursor");
      const scope = `briefing:${communityId}:${user.id}`;
      let cursor: z.infer<typeof cursorInput> | null = null;
      if (value) {
        try {
          if (value.length > 2048) throw new Error();
          cursor = cursorInput.parse(JSON.parse(Buffer.from(value, "base64url").toString()));
          if (cursor.scope !== scope) throw new Error();
        } catch {
          fail(400, "INVALID_CURSOR", "Please refresh your briefing.");
        }
      }
      const cutoff = new Date(Date.now() - HISTORY_LIFETIME);
      const prefix = Prisma.sql`WITH attention AS (
    SELECT e.id, e."storyId", e."createdAt", GREATEST(m."lastAcknowledgedAt", m."lastDiscussedAt") AS "lastContactAt",
      EXISTS (SELECT 1 FROM "FollowUp" f JOIN "StatusEntry" source ON source.id = f."sourceEntryId" WHERE f."resultEntryId" = e.id AND f.state = 'READY' AND source.visibility = 'VISIBLE' AND source.body IS NOT NULL AND source."allowFollowUp" = true AND source."contentVersion" = f."sourceContentVersion" AND source."createdAt" > ${cutoff}) AS ready
    FROM "StatusEntry" e JOIN "Membership" m ON m."currentEntryId" = e.id AND m."communityId" = e."communityId" AND m."userId" = e."authorId"
    WHERE e."communityId" = ${communityId}::uuid AND e."authorId" <> ${user.id}::uuid AND m.state = 'ACTIVE'
      AND e.visibility = 'VISIBLE' AND e.body IS NOT NULL AND e."expiresAt" > ${new Date()} AND e."createdAt" > ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "Report" r WHERE r."entryId" = e.id AND r."resolvedAt" IS NULL)
      AND NOT EXISTS (SELECT 1 FROM "Discussion" d WHERE d."entryId" = e.id)
      AND NOT EXISTS (SELECT 1 FROM "Acknowledgement" a WHERE a."entryId" = e.id AND a."contentVersion" = e."contentVersion")
  )`;
      const rows = await db.$queryRaw<BriefRow[]>(Prisma.sql`${prefix} SELECT * FROM attention
    ${cursor ? Prisma.sql`WHERE (CASE WHEN ready THEN 0 ELSE 1 END, COALESCE("lastContactAt", '-infinity'::timestamp), "createdAt", id) > (${cursor.ready ? 0 : 1}, ${cursor.last ? Prisma.sql`${new Date(cursor.last)}` : Prisma.sql`'-infinity'::timestamp`}, ${new Date(cursor.at)}, ${cursor.id}::uuid)` : Prisma.empty}
    ORDER BY ready DESC, "lastContactAt" ASC NULLS FIRST, "createdAt", id LIMIT 11`);
      const page = rows.slice(0, 10);
      const ids = page.map((row) => row.id);
      const [entries, totals, segment] = await Promise.all([
        db.statusEntry.findMany({ where: { id: { in: ids } }, include: entryInclude(communityId) }),
        db.$queryRaw<{ count: number; ready: number }[]>(
          Prisma.sql`${prefix} SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE ready)::int AS ready FROM attention`,
        ),
        db.segment.findFirst({
          where: { communityId, state: { in: ["DRAFT", "LIVE"] } },
          select: {
            id: true,
            state: true,
            queue: { orderBy: { position: "asc" }, select: { entryId: true, entryVersion: true } },
          },
        }),
      ]);
      const previous = ids.length
        ? await db.$queryRaw<
            { entryId: string; id: string; body: string; emoji: string | null; createdAt: Date }[]
          >(Prisma.sql`
    SELECT DISTINCT ON (current.id) current.id AS "entryId", old.id, old.body, old.emoji, old."createdAt"
    FROM "StatusEntry" current JOIN "StatusEntry" old ON old."storyId" = current."storyId" AND old."createdAt" < current."createdAt"
    WHERE current.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND old.visibility = 'VISIBLE' AND old.body IS NOT NULL AND old."createdAt" > ${cutoff}
    ORDER BY current.id, old."createdAt" DESC, old.id DESC`)
        : [];
      const replies = ids.length
        ? await db.$queryRaw<
            { storyId: string; body: string; createdAt: Date; displayName: string }[]
          >(Prisma.sql`
    SELECT DISTINCT ON (e."storyId") e."storyId", r.body, r."createdAt", u."displayName" FROM "StreamerReply" r
    JOIN "StatusEntry" e ON e.id = r."entryId" JOIN "User" u ON u.id = r."authorId"
    WHERE e."storyId" IN (${Prisma.join(page.map((row) => Prisma.sql`${row.storyId}::uuid`))}) AND e.visibility = 'VISIBLE' AND e.body IS NOT NULL AND e."createdAt" > ${cutoff}
    ORDER BY e."storyId", r."createdAt" DESC, r.id DESC`)
        : [];
      const broadcast = await eligibleIds(db, communityId, community.ownerId, ids, segment?.id);
      const items = page.flatMap((row) => {
        const entry = entries.find((entry) => entry.id === row.id);
        if (
          !entry ||
          unavailableReason(entry) ||
          entry.reports.length ||
          entry.discussions.length ||
          entry.acknowledgements.some((ack) => ack.contentVersion === entry.contentVersion)
        )
          return [];
        const card = toCard(entry, user.id);
        return [
          {
            entry: card,
            previous: previous.find((chapter) => chapter.entryId === row.id) ?? null,
            lastReply: replies.find((reply) => reply.storyId === row.storyId) ?? null,
            lastContactAt: row.lastContactAt,
            reason: row.ready
              ? "FOLLOW_UP"
              : card.hasPrevious
                ? "NEW_CHAPTER"
                : row.lastContactAt
                  ? "WAITING"
                  : "FIRST_TIME",
            broadcastEligible: broadcast.some((candidate) => candidate.id === row.id),
          },
        ];
      });
      const last = page.at(-1);
      return success({
        generatedAt: new Date().toISOString(),
        items,
        totals: totals[0],
        segment,
        nextCursor:
          rows.length > 10 && last
            ? Buffer.from(
                JSON.stringify({
                  id: last.id,
                  at: last.createdAt.toISOString(),
                  last: last.lastContactAt?.toISOString() ?? null,
                  ready: last.ready,
                  scope,
                }),
              ).toString("base64url")
            : null,
      });
    },
  },
];
