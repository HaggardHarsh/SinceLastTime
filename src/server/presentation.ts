import type { Prisma } from "@prisma/client";

export async function invalidatePresentation(
  tx: Prisma.TransactionClient,
  communityId: string,
  entryId?: string,
) {
  await tx.overlayState.updateMany({
    where: { communityId, ...(entryId ? { OR: [{ entryId }, { contextEntryId: entryId }] } : {}) },
    data: { entryId: null, entryVersion: null, contextEntryId: null, revision: { increment: 1 } },
  });
}
