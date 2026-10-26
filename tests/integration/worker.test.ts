import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { maintenance } from "../../src/server/maintenance";
import { validateMaintainedAccounts } from "../../src/server/oauth-maintenance";
import { encrypt } from "../../src/server/crypto";
import { fixture, call } from "./fixtures";
import type { EntryCard } from "../../src/shared/types";
const suite = process.env.INTEGRATION === "1" ? describe : describe.skip;
suite("independent worker jobs", () => {
  afterAll(() => db.$disconnect());
  it("delivers reminders while Twitch validation is waiting, and deduplicates concurrent passes", async () => {
    const f = await fixture();
    let release!: () => void;
    let validation: Promise<unknown> | undefined;
    try {
      const entry = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "Please check in after my interview",
          allowFollowUp: true,
        })
      ).data;
      await call(
        `communities/${f.communityId}/statuses/${entry.id}/acknowledgement`,
        f.owner,
        "PUT",
        { expectedVersion: entry.version },
      );
      await call(`communities/${f.communityId}/statuses/${entry.id}/follow-up`, f.owner, "POST", {
        days: 1,
        expectedVersion: entry.version,
      });
      const follow = await db.followUp.update({
        where: { sourceEntryId: entry.id },
        data: { dueAt: new Date(Date.now() - 1000) },
      });
      vi.stubEnv("TWITCH_CLIENT_ID", "worker-test-client");
      vi.stubEnv("TWITCH_CLIENT_SECRET", "worker-test-secret");
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
      await db.oAuthAccount.create({
        data: {
          userId: f.owner.id,
          accessTokenEnc: encrypt("test-access"),
          refreshTokenEnc: encrypt("test-refresh"),
          expiresAt: new Date(Date.now() + 86400000),
          validatedAt: new Date(Date.now() - 3600000),
          scopes: ["user:read:follows"],
        },
      });
      let started!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = globalThis.fetch;
      vi.stubGlobal("fetch", async (url: string | URL | Request, options?: RequestInit) => {
        if (String(url).includes("id.twitch.tv/oauth2/validate")) {
          started();
          await held;
          return Response.json({
            client_id: "worker-test-client",
            user_id: `demo-${f.owner.login}`,
            scopes: ["user:read:follows"],
            expires_in: 86400,
          });
        }
        return original(url, options);
      });
      validation = validateMaintainedAccounts(true);
      await waiting;
      await Promise.all([maintenance(), maintenance()]);
      expect(
        await db.notification.count({ where: { deduplicationKey: `followup-due:${follow.id}` } }),
      ).toBe(1);
      expect(
        (await db.workerHeartbeat.findUnique({ where: { name: "maintenance" } }))?.lastSeenAt,
      ).toBeTruthy();
      release();
      await validation;
      expect(
        (await db.workerHeartbeat.findUnique({ where: { name: "oauth" } }))?.lastSeenAt,
      ).toBeTruthy();
    } finally {
      release?.();
      await validation;
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await f.cleanup();
    }
  });
  it("purges a backlog in bounded passes and removes private receipt records with text", async () => {
    const f = await fixture();
    try {
      const rows = await f.seedUpdates(105);
      await db.statusEntry.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { createdAt: new Date(Date.now() - 32 * 86400000) },
      });
      await db.acknowledgement.create({
        data: { entryId: rows[0].id, streamerId: f.owner.id, contentVersion: 1 },
      });
      const first = await maintenance();
      expect(first.purged).toBe(100);
      expect(
        await db.statusEntry.count({ where: { communityId: f.communityId, body: { not: null } } }),
      ).toBe(5);
      const second = await maintenance();
      expect(second.purged).toBe(5);
      expect(await db.acknowledgement.count({ where: { streamerId: f.owner.id } })).toBe(0);
      expect((await maintenance()).purged).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
});
