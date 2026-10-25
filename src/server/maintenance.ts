import { db } from "./db";
import { HISTORY_LIFETIME } from "./time";
import { invalidatePresentation } from "./presentation";
import { validateAccount } from "./twitch";

export async function maintenance(now = new Date(), validateAll = false) {
  const accounts = await db.oAuthAccount.findMany({
    where: {
      user: { sessions: { some: { expiresAt: { gt: now } } } },
      ...(validateAll ? {} : { validatedAt: { lt: new Date(now.getTime() - 55 * 60_000) } }),
    },
    select: { userId: true },
  });
  for (const account of accounts) {
    try {
      await validateAccount(account.userId, validateAll);
    } catch {
      console.warn(JSON.stringify({ event: "oauth_validation_failed", userId: account.userId }));
    }
  }
  await db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(736281902) AS locked`;
      if (!locked[0]?.locked) return;
      const due = await tx.followUp.findMany({
        where: { state: "SCHEDULED", noticeSentAt: null, dueAt: { lte: now } },
        include: { sourceEntry: true },
        take: 100,
      });
      for (const followUp of due) {
        const source = followUp.sourceEntry;
        const membership = await tx.membership.findUnique({
          where: {
            communityId_userId: { communityId: followUp.communityId, userId: source.authorId },
          },
        });
        if (
          !source.body ||
          !source.allowFollowUp ||
          source.visibility !== "VISIBLE" ||
          source.createdAt.getTime() <= now.getTime() - HISTORY_LIFETIME ||
          membership?.state !== "ACTIVE"
        ) {
          await tx.followUp.update({ where: { id: followUp.id }, data: { state: "CANCELED" } });
          continue;
        }
        await tx.notification.upsert({
          where: { deduplicationKey: `followup-due:${followUp.id}` },
          create: {
            userId: source.authorId,
            communityId: followUp.communityId,
            type: "FOLLOWUP_DUE",
            referenceId: followUp.id,
            deduplicationKey: `followup-due:${followUp.id}`,
          },
          update: {},
        });
        await tx.followUp.update({ where: { id: followUp.id }, data: { noticeSentAt: now } });
      }
      const expired = await tx.statusEntry.findMany({
        where: { createdAt: { lte: new Date(now.getTime() - HISTORY_LIFETIME) }, purgedAt: null },
        select: { id: true, communityId: true },
      });
      for (const entry of expired) {
        await tx.statusEntry.update({
          where: { id: entry.id },
          data: {
            body: null,
            emoji: null,
            purgedAt: now,
            allowOnStream: false,
            allowFollowUp: false,
            approvedVersion: null,
            version: { increment: 1 },
          },
        });
        await tx.membership.updateMany({
          where: { currentEntryId: entry.id },
          data: { currentEntryId: null },
        });
        await tx.streamerReply.deleteMany({ where: { entryId: entry.id } });
        await tx.report.deleteMany({ where: { entryId: entry.id } });
        await tx.reaction.deleteMany({ where: { entryId: entry.id } });
        await tx.vote.deleteMany({ where: { entryId: entry.id } });
        await tx.followUp.updateMany({
          where: {
            OR: [{ sourceEntryId: entry.id }, { resultEntryId: entry.id }],
            state: { in: ["SCHEDULED", "READY"] },
          },
          data: { state: "CANCELED" },
        });
        await invalidatePresentation(tx, entry.communityId, entry.id);
      }
      await tx.appSession.deleteMany({ where: { expiresAt: { lte: now } } });
      await tx.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } });
      await tx.rateLimitBucket.deleteMany({ where: { expiresAt: { lte: now } } });
      await tx.workerHeartbeat.upsert({
        where: { name: "maintenance" },
        create: { name: "maintenance", lastSeenAt: now },
        update: { lastSeenAt: now },
      });
    },
    { timeout: 30_000 },
  );
}
