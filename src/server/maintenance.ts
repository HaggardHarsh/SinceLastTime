import { db } from "./db";
import { HISTORY_LIFETIME, retained } from "./time";
import { lockEntry } from "./entry-locks";
import { eraseEntry } from "./owned-statuses";

export async function heartbeat(name: string) {
  const lastSeenAt = new Date();
  await db.workerHeartbeat.upsert({
    where: { name },
    create: { name, lastSeenAt },
    update: { lastSeenAt },
  });
}

// Bounded work and short transactions. Concurrent workers recheck under the author's lock.
export async function maintenance(now = new Date()) {
  const due = await db.followUp.findMany({
    where: { state: "SCHEDULED", noticeSentAt: null, dueAt: { lte: now } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true, communityId: true, sourceEntryId: true },
  });
  let reminders = 0,
    purged = 0;
  for (const candidate of due) {
    await db.$transaction(async (tx) => {
      const { entry, member } = await lockEntry(
        tx,
        candidate.communityId,
        candidate.sourceEntryId,
        false,
      );
      const followUp = await tx.followUp.findUnique({ where: { id: candidate.id } });
      if (
        !followUp ||
        followUp.state !== "SCHEDULED" ||
        followUp.noticeSentAt ||
        followUp.dueAt > now
      )
        return;
      if (
        !entry.body ||
        !entry.allowFollowUp ||
        entry.visibility !== "VISIBLE" ||
        !retained(entry.createdAt, now) ||
        entry.contentVersion !== followUp.sourceContentVersion ||
        member?.state !== "ACTIVE"
      ) {
        await tx.followUp.update({ where: { id: followUp.id }, data: { state: "CANCELED" } });
        return;
      }
      await tx.notification.upsert({
        where: { deduplicationKey: `followup-due:${followUp.id}` },
        create: {
          userId: entry.authorId,
          communityId: candidate.communityId,
          type: "FOLLOWUP_DUE",
          referenceId: followUp.id,
          deduplicationKey: `followup-due:${followUp.id}`,
        },
        update: {},
      });
      await tx.followUp.update({ where: { id: followUp.id }, data: { noticeSentAt: now } });
      reminders++;
    });
  }
  const expired = await db.statusEntry.findMany({
    where: { createdAt: { lte: new Date(now.getTime() - HISTORY_LIFETIME) }, purgedAt: null },
    select: { id: true, communityId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  for (const candidate of expired) {
    await db.$transaction(async (tx) => {
      const { entry } = await lockEntry(tx, candidate.communityId, candidate.id, false);
      if (entry.purgedAt || retained(entry.createdAt, now)) return;
      await eraseEntry(tx, entry, now, true);
      purged++;
    });
  }
  await db.appSession.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.rateLimitBucket.deleteMany({ where: { expiresAt: { lte: now } } });
  await heartbeat("maintenance");
  return { reminders, purged };
}
