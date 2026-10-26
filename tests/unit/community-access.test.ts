import { expect, it, vi } from "vitest";
import { access } from "../../src/server/community";
const mocks = vi.hoisted(() => ({ membership: vi.fn(), refreshed: vi.fn() }));
vi.mock("../../src/server/auth", () => ({
  requireUser: async () => ({ id: "viewer" }),
  currentUser: async () => null,
}));
vi.mock("../../src/server/db", () => ({
  db: {
    community: {
      findUnique: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        ownerId: "owner",
        broadcasterId: "streamer",
      }),
    },
    membership: { findUnique: mocks.membership, findUniqueOrThrow: mocks.refreshed },
  },
}));
it("rejects suspension discovered after a cached follow check", async () => {
  mocks.membership.mockResolvedValue({
    id: "membership",
    state: "ACTIVE",
    isFollower: true,
    followCheckedAt: new Date(),
    role: "VIEWER",
  });
  mocks.refreshed.mockResolvedValue({ id: "membership", state: "SUSPENDED", role: "VIEWER" });
  await expect(
    access(new Request("http://localhost:3000"), "11111111-1111-4111-8111-111111111111"),
  ).rejects.toMatchObject({ code: "MEMBERSHIP_SUSPENDED" });
});
