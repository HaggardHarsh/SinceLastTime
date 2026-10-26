import { describe, expect, it, vi, beforeEach } from "vitest";
import { communitySearchTerm } from "../../src/shared/community-search";
import { communityRoutes } from "../../src/server/community";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), requireUser: vi.fn(), rateLimit: vi.fn() }));
vi.mock("../../src/server/db", () => ({ db: { community: { findMany: mocks.findMany } } }));
vi.mock("../../src/server/auth", () => ({ requireUser: mocks.requireUser, currentUser: vi.fn() }));
vi.mock("../../src/server/http", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("../../src/server/config", () => ({ demoMode: () => false }));
const route = communityRoutes.find((r) => r.pattern.test("communities/search"))!;
describe("community discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "viewer" });
    mocks.findMany.mockResolvedValue([]);
  });
  it.each([
    [" @Luna_plays ", "Luna_plays"],
    ["https://www.twitch.tv/Luna/videos?filter=all", "Luna"],
    ["twitch.tv/luna", "luna"],
    ["http://localhost:3000/c/luna?ref=share", "luna"],
    ["/c/luna", "luna"],
    ["Cozy corner", "Cozy corner"],
    ["https://example.com/", ""],
  ])("normalizes %s", (input, expected) => expect(communitySearchTerm(input)).toBe(expected));
  it("searches names and usernames literally and excludes demo boards in live mode", async () => {
    await route.handle(new Request("http://localhost/api/communities/search?q=cozy_100%25"), []);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          owner: { isDemo: false },
          OR: [
            { slug: { contains: "cozy\\_100\\%", mode: "insensitive" } },
            { displayName: { contains: "cozy\\_100\\%", mode: "insensitive" } },
          ],
        },
        take: 21,
      }),
    );
  });
  it("returns bounded public metadata with a more-results indicator", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        id: String(i),
        slug: `user${i}`,
        displayName: "Board",
        ownerId: "private-owner",
        broadcasterId: "private-id",
      })),
    );
    const response = await route.handle(
      new Request("http://localhost/api/communities/search?q=board"),
      [],
    );
    const { data } = await response.json();
    expect(data.communities).toHaveLength(20);
    expect(data.hasMore).toBe(true);
    expect(data.communities[0]).not.toHaveProperty("ownerId");
    expect(data.communities[0]).not.toHaveProperty("broadcasterId");
  });
  it("rejects anonymous requests before querying communities", async () => {
    mocks.requireUser.mockRejectedValue(new Error("Sign in"));
    await expect(
      route.handle(new Request("http://localhost/api/communities/search?q=luna"), []),
    ).rejects.toThrow("Sign in");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
