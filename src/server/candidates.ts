import { Prisma } from "@prisma/client";
import { db } from "./db";
import { access, uuid } from "./community";
import { entryInclude, toCard } from "./statuses";
import { decodeCursor, encodeCursor, literalSearch, searchInput } from "./pagination";
import { fail, success } from "./errors";
import { HISTORY_LIFETIME } from "./time";
import type { ApiRoute } from "./router";

export function eligibleSql(communityId: string, ownerId: string, segmentId?: string) {
  return Prisma.sql`WITH eligible AS (
    SELECT e.id, e."authorId", e.version, e."createdAt", e.body, u."displayName", u.login,
      m."discussionCount", m."lastDiscussedAt",
      (SELECT COUNT(*)::int FROM "Vote" v JOIN "Membership" vm ON vm."userId" = v."userId" AND vm."communityId" = e."communityId" AND vm.state = 'ACTIVE' WHERE v."entryId" = e.id) AS votes,
      (SELECT MIN(f."dueAt") FROM "FollowUp" f JOIN "StatusEntry" source ON source.id = f."sourceEntryId"
        WHERE f."resultEntryId" = e.id AND f.state = 'READY' AND source.body IS NOT NULL AND source.visibility = 'VISIBLE'
          AND source."allowFollowUp" = true AND source."contentVersion" = f."sourceContentVersion" AND source."createdAt" > ${new Date(Date.now() - HISTORY_LIFETIME)}) AS "followUpDue"
    FROM "StatusEntry" e JOIN "Membership" m ON m."currentEntryId" = e.id AND m."communityId" = e."communityId" AND m."userId" = e."authorId"
    JOIN "User" u ON u.id = e."authorId"
    WHERE e."communityId" = ${communityId}::uuid AND m.state = 'ACTIVE' AND e."authorId" <> ${ownerId}::uuid
      AND e.visibility = 'VISIBLE' AND e.body IS NOT NULL AND e."allowOnStream" = true AND e."expiresAt" > ${new Date()}
      AND e."createdAt" > ${new Date(Date.now() - HISTORY_LIFETIME)}
      AND NOT EXISTS (SELECT 1 FROM "Report" r WHERE r."entryId" = e.id AND r."resolvedAt" IS NULL)
      AND NOT EXISTS (SELECT 1 FROM "Discussion" d WHERE d."entryId" = e.id)
      ${segmentId ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "Discussion" d WHERE d."segmentId" = ${segmentId}::uuid AND d."authorId" = e."authorId")` : Prisma.empty}
  )`;
}
type RankedRow = {
  id: string;
  authorId: string;
  version: number;
  createdAt: Date;
  lastDiscussedAt: Date | null;
  followUpDue: Date | null;
  votes: number;
};
export async function selectLineup(
  tx: Prisma.TransactionClient,
  communityId: string,
  ownerId: string,
  segmentId?: string,
) {
  const prefix = eligibleSql(communityId, ownerId, segmentId);
  const follow = await tx.$queryRaw<RankedRow[]>(
    Prisma.sql`${prefix} SELECT * FROM eligible WHERE "followUpDue" IS NOT NULL ORDER BY "followUpDue", "createdAt", id LIMIT 1`,
  );
  const favorite = await tx.$queryRaw<RankedRow[]>(
    Prisma.sql`${prefix} SELECT * FROM eligible WHERE votes > 0 ${follow[0] ? Prisma.sql`AND "authorId" <> ${follow[0].authorId}::uuid` : Prisma.empty} ORDER BY votes DESC, "createdAt", id LIMIT 1`,
  );
  const special = [...follow, ...favorite];
  const rotation = await tx.$queryRaw<RankedRow[]>(Prisma.sql`${prefix} SELECT * FROM eligible
    ${special.length ? Prisma.sql`WHERE "authorId" NOT IN (${Prisma.join(special.map((row) => Prisma.sql`${row.authorId}::uuid`))})` : Prisma.empty}
    ORDER BY "lastDiscussedAt" ASC NULLS FIRST, "discussionCount", "createdAt", id LIMIT ${5 - special.length}`);
  return [
    ...rotation.map((row) => ({ ...row, reason: row.lastDiscussedAt ? "ROTATION" : "FIRST_TIME" })),
    ...favorite.map((row) => ({ ...row, reason: "COMMUNITY" })),
    ...follow.map((row) => ({ ...row, reason: "FOLLOW_UP" })),
  ];
}

export async function eligibleIds(
  tx: Prisma.TransactionClient,
  communityId: string,
  ownerId: string,
  ids: string[],
  segmentId?: string,
) {
  if (!ids.length) return [];
  return tx.$queryRaw<RankedRow[]>(
    Prisma.sql`${eligibleSql(communityId, ownerId, segmentId)} SELECT * FROM eligible WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`,
  );
}

export const candidateRoutes: ApiRoute[] = [
  {
    method: "GET",
    pattern: /^communities\/([^/]+)\/candidates$/,
    handle: async (request, [communityId]) => {
      const { user, community } = await access(request, communityId, "moderator");
      const params = new URL(request.url).searchParams;
      const segmentId = params.get("segmentId") ?? undefined;
      if (segmentId) {
        uuid.parse(segmentId);
        if (
          !(await db.segment.findFirst({
            where: { id: segmentId, communityId, state: { in: ["DRAFT", "LIVE"] } },
          }))
        )
          fail(404, "NOT_FOUND", "This segment is unavailable.");
      }
      const q = searchInput.parse(params.get("q") ?? "");
      const scope = `candidates:${communityId}:${segmentId ?? ""}:${q}`;
      const cursor = decodeCursor(params.get("cursor"), scope);
      const search = `%${literalSearch(q)}%`;
      const ids = await db.$queryRaw<
        RankedRow[]
      >(Prisma.sql`${eligibleSql(communityId, community.ownerId, segmentId)} SELECT * FROM eligible WHERE true
    ${q ? Prisma.sql`AND (body ILIKE ${search} OR "displayName" ILIKE ${search} OR login ILIKE ${search})` : Prisma.empty}
    ${cursor ? Prisma.sql`AND ("createdAt", id) < (${cursor.createdAt}, ${cursor.id}::uuid)` : Prisma.empty}
    ORDER BY "createdAt" DESC, id DESC LIMIT 31`);
      const entries = await db.statusEntry.findMany({
        where: {
          id: { in: ids.slice(0, 30).map((row) => row.id) },
          visibility: "VISIBLE",
          body: { not: null },
          expiresAt: { gt: new Date() },
          createdAt: { gt: new Date(Date.now() - HISTORY_LIFETIME) },
        },
        include: entryInclude(communityId),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return success({
        entries: entries.map((entry) => toCard(entry, user.id)),
        nextCursor: ids.length > 30 ? encodeCursor(ids[29], scope) : null,
      });
    },
  },
];
