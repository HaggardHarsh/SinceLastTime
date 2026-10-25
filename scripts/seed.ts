import "dotenv/config";
import { db } from "../src/server/db";

async function seed() {
  if (process.env.DEMO_MODE !== "true" || process.env.NODE_ENV === "production") throw new Error("Demo seed requires DEMO_MODE=true outside production.");
  const people = [
    ["luna", "Luna", "OWNER"], ["rohan", "Rohan", "MODERATOR"], ["maya", "Maya", "VIEWER"],
    ["olive", "Olive", "VIEWER"], ["kai", "Kai", "VIEWER"], ["nina", "Nina", "VIEWER"],
    ["ben", "Ben", "VIEWER"], ["jules", "Jules", "VIEWER"], ["avery", "Avery", "VIEWER"],
    ["visitor", "Visitor", "VIEWER"], ["suspended", "Suspended member", "VIEWER"],
  ] as const;
  const users = new Map<string, string>();
  for (const [login, displayName] of people) {
    const user = await db.user.upsert({ where: { twitchId: `demo-${login}` }, create: { twitchId: `demo-${login}`, login, displayName, avatarUrl: "", isDemo: true }, update: {} });
    users.set(login, user.id);
  }
  const ownerId = users.get("luna")!;
  const community = await db.community.upsert({ where: { broadcasterId: "demo-luna" }, create: { ownerId, broadcasterId: "demo-luna", slug: "luna", displayName: "Luna’s living room", avatarUrl: "", description: "Cozy games, little wins, and the people behind the usernames. Come as you are. ✨" }, update: {} });
  for (const [login, , role] of people) {
    if (login === "visitor") continue;
    const userId = users.get(login)!;
    await db.membership.upsert({ where: { communityId_userId: { communityId: community.id, userId } }, create: { communityId: community.id, userId, role, isFollower: true, followCheckedAt: new Date(), state: login === "suspended" ? "SUSPENDED" : "ACTIVE", discussionCount: login === "maya" ? 1 : 0, lastDiscussedAt: login === "maya" ? new Date(Date.now() - 3 * 86_400_000) : null }, update: {} });
  }
  const fixtures = [
    ["maya", "I got the job! Starting Monday. Thank you for the good luck wishes 🥹", "🎉", "Small win", true],
    ["olive", "Third attempt at sourdough. Still a brick. But a slightly more photogenic brick.", "🍞", "Making something", true],
    ["kai", "Finished the little pixel farm I’ve been working on after streams. Every chicken has a name now.", "🌱", "Making something", true],
    ["nina", "The cat I adopted last week finally sat on my lap. I’m officially furniture.", "🐈", "Life update", true],
    ["ben", "A slow Sunday, a big cup of tea, and finally making a dent in my book. Happy to be here.", "☕", "Life update", false],
    ["jules", "Beat the boss we were stuck on last stream. Only took me 37 more attempts!", "🎮", "Small win", true],
    ["avery", "My first craft fair is this weekend. Any advice for someone packing way too many stickers?", "🎨", "Question", true],
    ["luna", "Picking up that abandoned embroidery project. You can all hold me to it next time.", "🪡", "Making something", true],
  ] as const;
  for (const [index, [login, body, emoji, category, allowOnStream]] of fixtures.entries()) {
    const authorId = users.get(login)!;
    const existing = await db.story.findFirst({ where: { communityId: community.id, authorId } });
    if (existing) continue;
    const story = await db.story.create({ data: { communityId: community.id, authorId } });
    const entry = await db.statusEntry.create({ data: { communityId: community.id, authorId, storyId: story.id, body, emoji, category, allowOnStream, allowFollowUp: true, approvedVersion: allowOnStream ? 1 : null, createdAt: new Date(Date.now() - (index + 1) * 2_400_000), expiresAt: new Date(Date.now() + 6 * 86_400_000) } });
    await db.membership.update({ where: { communityId_userId: { communityId: community.id, userId: authorId } }, data: { currentEntryId: entry.id } });
    for (const voter of (login === "olive" ? ["maya", "kai", "nina", "jules"] : login === "kai" ? ["olive", "ben"] : ["rohan"])) {
      await db.vote.create({ data: { entryId: entry.id, userId: users.get(voter)! } });
    }
    for (const reactor of ["rohan", "avery", "luna"]) await db.reaction.create({ data: { entryId: entry.id, userId: users.get(reactor)!, choice: login === "maya" ? "🎉" : "❤️" } });
    if (login === "maya") {
      const previous = await db.statusEntry.create({ data: { communityId: community.id, authorId, storyId: story.id, body: "First job interview tomorrow. Wish me luck!", emoji: "🤞", allowOnStream: true, allowFollowUp: true, approvedVersion: 1, createdAt: new Date(Date.now() - 3 * 86_400_000), expiresAt: new Date(Date.now() + 4 * 86_400_000) } });
      const segment = await db.segment.create({ data: { communityId: community.id, state: "ENDED", startedAt: new Date(Date.now() - 3 * 86_400_000), endedAt: new Date(Date.now() - 3 * 86_400_000 + 600_000) } });
      await db.discussion.create({ data: { segmentId: segment.id, entryId: previous.id, authorId, createdAt: new Date(Date.now() - 3 * 86_400_000) } });
      await db.followUp.create({ data: { communityId: community.id, sourceEntryId: previous.id, resultEntryId: entry.id, requestedById: ownerId, dueAt: new Date(Date.now() - 86_400_000), state: "READY", noticeSentAt: new Date() } });
      await db.streamerReply.create({ data: { entryId: previous.id, authorId: ownerId, body: "You’ve got this, Maya! Tell us how it goes. 💜" } });
    }
  }
  console.log("Demo ready: Luna’s living room. Sign in as luna, rohan, maya, olive, kai, nina, ben, jules, avery, or visitor.");
}

seed().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
