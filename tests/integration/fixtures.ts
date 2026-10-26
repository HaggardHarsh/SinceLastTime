import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";

export const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
export type Actor = { id: string; login: string; cookie: string };
export async function call<T = Record<string, unknown>>(
  path: string,
  actor?: Actor,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(actor ? { Cookie: actor.cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, ...(await response.json()) } as {
    status: number;
    data: T;
    error?: { code: string; message: string };
  };
}
export async function fixture() {
  const users: string[] = [];
  const communities: string[] = [];
  async function actor(kind: string) {
    const login = `upgrade_${kind}_${randomUUID().slice(0, 8)}`;
    const user = await db.user.create({
      data: { twitchId: `demo-${login}`, login, displayName: kind, avatarUrl: "", isDemo: true },
    });
    users.push(user.id);
    const response = await fetch(`${base}/api/auth/demo`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ login }),
    });
    if (!response.ok)
      throw new Error(`Fixture login failed: ${response.status} ${await response.text()}`);
    return { id: user.id, login, cookie: response.headers.get("set-cookie")!.split(";")[0] };
  }
  const owner = await actor("owner");
  const viewer = await actor("viewer");
  const peer = await actor("peer");
  const response = await call<{ id: string; slug: string }>("communities", owner, "POST", {
    displayName: "Upgrade test community",
  });
  if (response.status !== 201) throw new Error(JSON.stringify(response));
  const communityId = response.data.id;
  communities.push(communityId);
  for (const member of [viewer, peer])
    await call(`communities/${communityId}/join`, member, "POST", {});
  return {
    owner,
    viewer,
    peer,
    communityId,
    slug: response.data.slug,
    actor,
    async seedUpdates(count: number) {
      const suffix = randomUUID().slice(0, 8);
      const rows = Array.from({ length: count }, (_, index) => ({
        id: randomUUID(),
        authorId: randomUUID(),
        storyId: randomUUID(),
        createdAt: new Date(Date.now() - (count - index) * 1000),
        login: `load_${suffix}_${index}`,
      }));
      users.push(...rows.map((row) => row.authorId));
      await db.$transaction(async (tx) => {
        await tx.user.createMany({
          data: rows.map((row) => ({
            id: row.authorId,
            twitchId: `demo-${row.login}`,
            login: row.login,
            displayName: row.login,
            avatarUrl: "",
            isDemo: true,
          })),
        });
        await tx.story.createMany({
          data: rows.map((row) => ({ id: row.storyId, communityId, authorId: row.authorId })),
        });
        await tx.statusEntry.createMany({
          data: rows.map((row, index) => ({
            id: row.id,
            communityId,
            authorId: row.authorId,
            storyId: row.storyId,
            body: `Load fixture ${index}`,
            createdAt: row.createdAt,
            expiresAt: new Date(Date.now() + 7 * 86400000),
            allowOnStream: true,
          })),
        });
        await tx.membership.createMany({
          data: rows.map((row) => ({
            communityId,
            userId: row.authorId,
            currentEntryId: row.id,
            isFollower: true,
            followCheckedAt: new Date(),
            discussionCount: 1,
            lastDiscussedAt: new Date(),
          })),
        });
      });
      return rows;
    },
    async cleanup() {
      await db.community.deleteMany({ where: { id: { in: communities } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    },
  };
}
