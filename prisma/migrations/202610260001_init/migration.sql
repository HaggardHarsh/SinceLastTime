-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MODERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "MemberState" AS ENUM ('ACTIVE', 'LEFT', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "SegmentState" AS ENUM ('DRAFT', 'LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "QueueState" AS ENUM ('PENDING', 'SHOWN', 'DISCUSSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FollowUpState" AS ENUM ('SCHEDULED', 'READY', 'COMPLETED', 'DISMISSED', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "twitchId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "userId" UUID NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "validatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "OAuthAttempt" (
    "stateHash" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" UUID NOT NULL,
    "broadcasterId" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT 'A little space to catch up, celebrate the small things, and pick up where we left off.',
    "prompt" TEXT NOT NULL DEFAULT 'What’s happened since last time?',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "state" "MemberState" NOT NULL DEFAULT 'ACTIVE',
    "isFollower" BOOLEAN NOT NULL DEFAULT false,
    "followCheckedAt" TIMESTAMP(3),
    "currentEntryId" UUID,
    "discussionCount" INTEGER NOT NULL DEFAULT 0,
    "lastDiscussedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEntry" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "body" TEXT,
    "emoji" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Life update',
    "allowOnStream" BOOLEAN NOT NULL DEFAULT false,
    "allowFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedVersion" INTEGER,
    "visibility" "Visibility" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "StatusEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "choice" TEXT NOT NULL,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamerReply" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "state" "SegmentState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "entryVersion" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "QueueState" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discussion" (
    "id" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "sourceEntryId" UUID NOT NULL,
    "resultEntryId" UUID,
    "requestedById" UUID NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "state" "FollowUpState" NOT NULL DEFAULT 'SCHEDULED',
    "noticeSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "communityId" UUID,
    "type" TEXT NOT NULL,
    "referenceId" UUID NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverlayCredential" (
    "communityId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverlayCredential_pkey" PRIMARY KEY ("communityId")
);

-- CreateTable
CREATE TABLE "OverlayState" (
    "communityId" UUID NOT NULL,
    "entryId" UUID,
    "entryVersion" INTEGER,
    "contextEntryId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OverlayState_pkey" PRIMARY KEY ("communityId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "name" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_twitchId_key" ON "User"("twitchId");

-- CreateIndex
CREATE INDEX "AppSession_userId_idx" ON "AppSession"("userId");

-- CreateIndex
CREATE INDEX "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Community_broadcasterId_key" ON "Community"("broadcasterId");

-- CreateIndex
CREATE UNIQUE INDEX "Community_ownerId_key" ON "Community"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Community_slug_key" ON "Community"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_currentEntryId_key" ON "Membership"("currentEntryId");

-- CreateIndex
CREATE INDEX "Membership_communityId_state_idx" ON "Membership"("communityId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_communityId_userId_key" ON "Membership"("communityId", "userId");

-- CreateIndex
CREATE INDEX "Story_communityId_authorId_createdAt_idx" ON "Story"("communityId", "authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Story_id_communityId_authorId_key" ON "Story"("id", "communityId", "authorId");

-- CreateIndex
CREATE INDEX "StatusEntry_communityId_createdAt_id_idx" ON "StatusEntry"("communityId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "StatusEntry_storyId_createdAt_idx" ON "StatusEntry"("storyId", "createdAt");

-- CreateIndex
CREATE INDEX "StatusEntry_expiresAt_idx" ON "StatusEntry"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusEntry_id_communityId_authorId_key" ON "StatusEntry"("id", "communityId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_entryId_userId_key" ON "Reaction"("entryId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_entryId_userId_key" ON "Vote"("entryId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerReply_entryId_key" ON "StreamerReply"("entryId");

-- CreateIndex
CREATE INDEX "Report_resolvedAt_idx" ON "Report"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_entryId_reporterId_key" ON "Report"("entryId", "reporterId");

-- CreateIndex
CREATE INDEX "Segment_communityId_createdAt_idx" ON "Segment"("communityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_segmentId_position_key" ON "QueueItem"("segmentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_segmentId_entryId_key" ON "QueueItem"("segmentId", "entryId");

-- CreateIndex
CREATE INDEX "Discussion_entryId_idx" ON "Discussion"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Discussion_segmentId_authorId_key" ON "Discussion"("segmentId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_sourceEntryId_key" ON "FollowUp"("sourceEntryId");

-- CreateIndex
CREATE INDEX "FollowUp_state_dueAt_idx" ON "FollowUp"("state", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_deduplicationKey_key" ON "Notification"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OverlayCredential_tokenHash_key" ON "OverlayCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "AuditEvent_communityId_createdAt_idx" ON "AuditEvent"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEntry" ADD CONSTRAINT "StatusEntry_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEntry" ADD CONSTRAINT "StatusEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEntry" ADD CONSTRAINT "StatusEntry_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamerReply" ADD CONSTRAINT "StreamerReply_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamerReply" ADD CONSTRAINT "StreamerReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "StatusEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_resultEntryId_fkey" FOREIGN KEY ("resultEntryId") REFERENCES "StatusEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlayCredential" ADD CONSTRAINT "OverlayCredential_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlayState" ADD CONSTRAINT "OverlayState_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Enforce channel/author ownership for current entries and stories.
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_current_entry_owner_fkey" FOREIGN KEY ("currentEntryId", "communityId", "userId") REFERENCES "StatusEntry" ("id", "communityId", "authorId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StatusEntry" ADD CONSTRAINT "StatusEntry_story_owner_fkey" FOREIGN KEY ("storyId", "communityId", "authorId") REFERENCES "Story" ("id", "communityId", "authorId");
CREATE UNIQUE INDEX "Segment_one_active_per_community" ON "Segment" ("communityId") WHERE "state" IN ('DRAFT', 'LIVE');
