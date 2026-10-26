import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { statusRoutes } from "../../src/server/statuses";
import { segmentRoutes } from "../../src/server/segments";
import { acknowledgementRoutes } from "../../src/server/acknowledgements";
import { followUpRoutes } from "../../src/server/followups";
import { fixture, call, base, type Actor } from "./fixtures";
import type { EntryCard } from "../../src/shared/types";
const suite = process.env.INTEGRATION === "1" ? describe : describe.skip;
function gate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>((resolve) => {
      enter = resolve;
    }),
    held: new Promise<void>((resolve) => {
      release = resolve;
    }),
    enter: () => enter(),
    release: () => release(),
  };
}
function request(actor: Actor, body: unknown, method = "POST") {
  return new Request(`${base}/api/test`, {
    method,
    headers: { cookie: actor.cookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function shown(f: Awaited<ReturnType<typeof fixture>>) {
  const entry = (
    await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
      body: "The version that was shown",
      allowOnStream: true,
      allowFollowUp: true,
    })
  ).data;
  const segment = (
    await call<{ segment: { id: string } }>(
      `communities/${f.communityId}/segments`,
      f.owner,
      "POST",
      {},
    )
  ).data.segment;
  await call(`communities/${f.communityId}/segments/${segment.id}/start`, f.owner, "POST", {});
  await call(`communities/${f.communityId}/statuses/${entry.id}/review`, f.owner, "POST", {
    action: "approve",
    expectedVersion: entry.version,
  });
  await call(`communities/${f.communityId}/segments/${segment.id}/show`, f.owner, "POST", {
    entryId: entry.id,
    expectedVersion: entry.version,
  });
  return { entry, segment };
}
suite("database-backed request interleavings", () => {
  afterAll(() => db.$disconnect());
  it("rejects an edit when discussion completes after the edit request starts", async () => {
    const f = await fixture();
    const barrier = gate();
    const original = db.rateLimitBucket.upsert.bind(db.rateLimitBucket);
    const spy = vi.spyOn(db.rateLimitBucket, "upsert").mockImplementation((args) => {
      const result = original(args);
      return result.then(async (value) => {
        if (args.where.key?.includes(`:edit:${f.communityId}:`)) {
          barrier.enter();
          await barrier.held;
        }
        return value;
      }) as typeof result;
    });
    try {
      const { entry, segment } = await shown(f);
      const editing = statusRoutes
        .find((route) => route.method === "PATCH")!
        .handle(
          request(
            f.viewer,
            { expectedVersion: entry.version, body: "An edit arriving too late" },
            "PATCH",
          ),
          [f.communityId, entry.id],
        );
      await barrier.entered;
      expect(
        (
          await call(
            `communities/${f.communityId}/segments/${segment.id}/discuss`,
            f.owner,
            "POST",
            { entryId: entry.id, expectedVersion: entry.version },
          )
        ).status,
      ).toBe(200);
      barrier.release();
      await expect(editing).rejects.toMatchObject({ code: "ADD_UPDATE_INSTEAD" });
      expect((await db.statusEntry.findUniqueOrThrow({ where: { id: entry.id } })).body).toBe(
        entry.body,
      );
    } finally {
      barrier.release();
      spy.mockRestore();
      await f.cleanup();
    }
  });
  it("rejects a stale discussion when an edit commits before the discussion transaction", async () => {
    const f = await fixture();
    const barrier = gate();
    try {
      const { entry, segment } = await shown(f);
      const original = db.segment.findFirst.bind(db.segment);
      const spy = vi.spyOn(db.segment, "findFirst").mockImplementation((args) => {
        const result = original(args);
        return result.then(async (value) => {
          if (args?.where?.id === segment.id) {
            barrier.enter();
            await barrier.held;
          }
          return value;
        }) as typeof result;
      });
      try {
        const route = segmentRoutes.find((route) =>
          route.pattern.test(`communities/${f.communityId}/segments/${segment.id}/discuss`),
        )!;
        const discussing = route.handle(
          request(f.owner, { entryId: entry.id, expectedVersion: entry.version }),
          [f.communityId, segment.id, "discuss"],
        );
        await barrier.entered;
        expect(
          (
            await call(`communities/${f.communityId}/statuses/${entry.id}`, f.viewer, "PATCH", {
              body: "A new version to review",
              expectedVersion: entry.version,
            })
          ).status,
        ).toBe(200);
        barrier.release();
        await expect(discussing).rejects.toMatchObject({ code: "STALE_VERSION" });
        expect(await db.discussion.count({ where: { entryId: entry.id } })).toBe(0);
      } finally {
        barrier.release();
        spy.mockRestore();
      }
    } finally {
      await f.cleanup();
    }
  });
  it("rejects acknowledgement and follow-up requests that lose races with author changes", async () => {
    const f = await fixture();
    try {
      let entry = (
        await call<EntryCard>(`communities/${f.communityId}/statuses`, f.viewer, "POST", {
          body: "Original personal update",
          allowFollowUp: true,
        })
      ).data;
      for (const action of ["acknowledgement", "follow-up"] as const) {
        if (action === "follow-up")
          await call(
            `communities/${f.communityId}/statuses/${entry.id}/acknowledgement`,
            f.owner,
            "PUT",
            { expectedVersion: entry.version },
          );
        const barrier = gate();
        const original = db.rateLimitBucket.upsert.bind(db.rateLimitBucket);
        const spy = vi.spyOn(db.rateLimitBucket, "upsert").mockImplementation((args) => {
          const result = original(args);
          return result.then(async (value) => {
            if (args.where.key?.includes(`:attention:${f.communityId}:`)) {
              barrier.enter();
              await barrier.held;
            }
            return value;
          }) as typeof result;
        });
        try {
          const route = action === "acknowledgement" ? acknowledgementRoutes[0] : followUpRoutes[0];
          const pending = route.handle(
            request(
              f.owner,
              { expectedVersion: entry.version, days: 1 },
              action === "acknowledgement" ? "PUT" : "POST",
            ),
            [f.communityId, entry.id],
          );
          await barrier.entered;
          entry = (
            await call<EntryCard>(
              `communities/${f.communityId}/statuses/${entry.id}`,
              f.viewer,
              "PATCH",
              {
                expectedVersion: entry.version,
                ...(action === "acknowledgement"
                  ? { body: "The author changed their update" }
                  : { allowFollowUp: false }),
              },
            )
          ).data;
          barrier.release();
          await expect(pending).rejects.toMatchObject({ code: "STALE_VERSION" });
        } finally {
          barrier.release();
          spy.mockRestore();
        }
      }
      expect(await db.followUp.count({ where: { sourceEntryId: entry.id } })).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
});
