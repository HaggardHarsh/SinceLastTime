import type { Prisma, StatusEntry } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { access, uuid } from "./community";
import { checkVersion, lockEntry } from "./entry-locks";
import { fail, parseBody, success } from "./errors";
import { rateLimit } from "./http";
import { retained } from "./time";
import type { ApiRoute } from "./router";

export async function attentionAllowed(tx: Prisma.TransactionClient, entry: StatusEntry) {
  if (!entry.body || entry.visibility !== "VISIBLE" || !retained(entry.createdAt))
    fail(404, "NOT_FOUND", "This update is no longer available.");
  if (await tx.report.count({ where: { entryId: entry.id, resolvedAt: null } }))
    fail(409, "REVIEW_REQUIRED", "The community team needs to review this update first.");
}

// Caller owns the community and holds its author's membership and entry locks.
export async function acknowledgeLocked(
  tx: Prisma.TransactionClient,
  entry: StatusEntry,
  streamerId: string,
  notify = true,
) {
  if (entry.authorId === streamerId) fail(400, "OWN_UPDATE", "Choose a community member’s update.");
  await attentionAllowed(tx, entry);
  const existing = await tx.acknowledgement.findUnique({
    where: { entryId_contentVersion: { entryId: entry.id, contentVersion: entry.contentVersion } },
  });
  if (existing) return existing;
  const receipt = await tx.acknowledgement.create({
    data: { entryId: entry.id, streamerId, contentVersion: entry.contentVersion },
  });
  await tx.membership.update({
    where: { communityId_userId: { communityId: entry.communityId, userId: entry.authorId } },
    data: { lastAcknowledgedAt: receipt.createdAt },
  });
  await tx.followUp.updateMany({
    where: { resultEntryId: entry.id, state: "READY" },
    data: { state: "COMPLETED" },
  });
  // A public reply already has its own notification. Never notify twice for that action.
  if (notify)
    await tx.notification.upsert({
      where: { deduplicationKey: `acknowledged:${receipt.id}` },
      create: {
        userId: entry.authorId,
        communityId: entry.communityId,
        type: "ACKNOWLEDGED",
        referenceId: receipt.id,
        deduplicationKey: `acknowledged:${receipt.id}`,
      },
      update: {},
    });
  return receipt;
}

export const acknowledgementRoutes: ApiRoute[] = [
  {
    method: "PUT",
    pattern: /^communities\/([^/]+)\/statuses\/([^/]+)\/acknowledgement$/,
    handle: async (request, [communityId, id]) => {
      const { user } = await access(request, communityId, "owner");
      uuid.parse(id);
      const { expectedVersion } = await parseBody(
        request,
        z.object({ expectedVersion: z.number().int().positive() }),
      );
      await rateLimit(user.id, `attention:${communityId}`, 60, 60_000);
      const receipt = await db.$transaction(async (tx) => {
        const { entry } = await lockEntry(tx, communityId, id);
        checkVersion(entry.version, expectedVersion);
        return acknowledgeLocked(tx, entry, user.id);
      });
      return success({
        acknowledgedAt: receipt.createdAt.toISOString(),
        contentVersion: receipt.contentVersion,
      });
    },
  },
];
