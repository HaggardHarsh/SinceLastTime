-- Purge a bounded oldest-first batch without scanning retained metadata indefinitely.
CREATE INDEX "StatusEntry_retention_backlog" ON "StatusEntry" ("createdAt", "id") WHERE "purgedAt" IS NULL;
