import type { Prisma } from "@prisma/client";
import { fail } from "./errors";

// Lock order: segment (if needed), memberships, entries, dependents, overlay.
// Callers touching several authors/entries must acquire each group in sorted ID order.
export async function lockMember(
  tx: Prisma.TransactionClient,
  communityId: string,
  userId: string,
  active = false,
) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "communityId" = ${communityId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
  const member = await tx.membership.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });
  if (active && member?.state !== "ACTIVE")
    fail(403, "MEMBERSHIP_INACTIVE", "Community access has changed. Please refresh.");
  return member;
}

export async function lockEntry(
  tx: Prisma.TransactionClient,
  communityId: string,
  entryId: string,
  active = true,
) {
  const identity = await tx.statusEntry.findFirst({
    where: { id: entryId, communityId },
    select: { authorId: true },
  });
  if (!identity) fail(404, "NOT_FOUND", "This update is unavailable.");
  const member = await lockMember(tx, communityId, identity.authorId, active);
  await tx.$queryRaw`SELECT id FROM "StatusEntry" WHERE id = ${entryId}::uuid FOR UPDATE`;
  const entry = await tx.statusEntry.findFirst({ where: { id: entryId, communityId } });
  if (!entry) fail(404, "NOT_FOUND", "This update is unavailable.");
  return { entry, member };
}

export function checkVersion(actual: number, expected: number) {
  if (actual !== expected)
    fail(409, "STALE_VERSION", "This update changed. Refresh it and try again.");
}
