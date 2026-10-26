-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "lastAcknowledgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StatusEntry" ADD COLUMN     "contentVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "QueueItem" ADD COLUMN     "shownVersion" INTEGER;

-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "sourceContentVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Acknowledgement" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "streamerId" UUID NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Acknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySetup" (
    "communityId" UUID NOT NULL,
    "profileReviewedAt" TIMESTAMP(3),
    "panelAddedAt" TIMESTAMP(3),
    "chatCommandAddedAt" TIMESTAMP(3),
    "overlayTestedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "CommunitySetup_pkey" PRIMARY KEY ("communityId")
);

-- CreateIndex
CREATE INDEX "Acknowledgement_streamerId_createdAt_idx" ON "Acknowledgement"("streamerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Acknowledgement_entryId_contentVersion_key" ON "Acknowledgement"("entryId", "contentVersion");

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySetup" ADD CONSTRAINT "CommunitySetup_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

