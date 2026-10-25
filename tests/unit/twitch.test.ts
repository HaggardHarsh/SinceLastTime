import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../src/server/crypto";
import { followsChannel, validateAccount } from "../../src/server/twitch";

const mocks = vi.hoisted(() => ({ account: vi.fn(), update: vi.fn(), removeSessions: vi.fn(), removeAccount: vi.fn(), memberships: vi.fn(), identity: vi.fn() }));
vi.mock("../../src/server/db", () => ({ db: {
  oAuthAccount: { findUnique: mocks.account, update: mocks.update, deleteMany: mocks.removeAccount },
  appSession: { deleteMany: mocks.removeSessions }, membership: { updateMany: mocks.memberships }, user: { findUniqueOrThrow: mocks.identity },
  $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
} }));

describe("Twitch verification adapter", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    process.env.TWITCH_CLIENT_ID = "test-client";
    process.env.TWITCH_CLIENT_SECRET = "test-only-secret";
    mocks.account.mockResolvedValue({ userId: "viewer", accessTokenEnc: encrypt("test-access-token"), refreshTokenEnc: encrypt("test-refresh-token"), expiresAt: new Date(Date.now() + 3_600_000), validatedAt: new Date(Date.now() - 3_600_000), user: { twitchId: "viewer-twitch-id" } });
    mocks.identity.mockResolvedValue({ twitchId: "viewer-twitch-id" });
    mocks.update.mockResolvedValue({}); mocks.removeSessions.mockResolvedValue({ count: 1 }); mocks.removeAccount.mockResolvedValue({ count: 1 }); mocks.memberships.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("verifies a specific broadcaster with the viewer’s own authorization", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [{ broadcaster_id: "streamer" }] }));
    expect(await followsChannel("viewer", "streamer")).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("user_id=viewer-twitch-id&broadcaster_id=streamer");
    expect(options.headers.Authorization).toBe("Bearer test-access-token");
  });
  it("treats an empty followed-channel result as a non-follower", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await followsChannel("viewer", "streamer")).toBe(false);
  });
  it("fails closed when Twitch is unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network offline"));
    await expect(followsChannel("viewer", "streamer")).rejects.toMatchObject({ status: 503 });
  });
  it("revokes app sessions when a maintained grant is invalidated", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(validateAccount("viewer")).rejects.toMatchObject({ status: 401 });
    expect(mocks.removeSessions).toHaveBeenCalledWith({ where: { userId: "viewer" } });
  });
  it("rejects a token issued for a different Twitch client", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ client_id: "another-client", user_id: "viewer-twitch-id", scopes: ["user:read:follows"], expires_in: 3600 }));
    await expect(validateAccount("viewer")).rejects.toMatchObject({ status: 401 });
  });
  it("updates the validation timestamp after a valid hourly check", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ client_id: "test-client", user_id: "viewer-twitch-id", scopes: ["user:read:follows"], expires_in: 3600 }));
    await validateAccount("viewer");
    expect(mocks.update).toHaveBeenCalledWith({ where: { userId: "viewer" }, data: { validatedAt: expect.any(Date) } });
  });
});
