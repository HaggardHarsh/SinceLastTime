import { describe, expect, it } from "vitest";
import { selectShortlist, type Candidate } from "../../src/server/ranking";

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  authorId: id,
  createdAt: new Date("2026-10-20"),
  discussionCount: 0,
  lastDiscussedAt: null,
  votes: 0,
  followUpDue: null,
  ...overrides,
});
describe("hybrid conversation selection", () => {
  it("reserves a community pick and follow-up while giving three slots to rotation", () => {
    const result = selectShortlist([
      candidate("fav", { votes: 20 }),
      candidate("follow", { votes: 30, followUpDue: new Date() }),
      ...["a", "b", "c", "d"].map((id) => candidate(id)),
    ]);
    expect(result.map((s) => s.reason)).toEqual([
      "FIRST_TIME",
      "FIRST_TIME",
      "FIRST_TIME",
      "COMMUNITY",
      "FOLLOW_UP",
    ]);
    expect(result.map((s) => s.entryId)).toEqual(["a", "b", "c", "fav", "follow"]);
  });
  it("fills missing special slots with fair rotation", () => {
    expect(selectShortlist(["a", "b", "c", "d", "e", "f"].map((id) => candidate(id)))).toHaveLength(
      5,
    );
  });
  it("prioritizes never-featured people, then longest waiting people", () => {
    const result = selectShortlist([
      candidate("recent", { lastDiscussedAt: new Date("2026-10-25") }),
      candidate("old", { lastDiscussedAt: new Date("2026-10-01") }),
      candidate("new"),
    ]);
    expect(result.map((s) => s.entryId)).toEqual(["new", "old", "recent"]);
  });
  it("never includes the same author twice or an already discussed author", () => {
    const result = selectShortlist(
      [
        candidate("a", { authorId: "one" }),
        candidate("b", { authorId: "one", votes: 3 }),
        candidate("c", { authorId: "two" }),
      ],
      new Set(["two"]),
    );
    expect(result).toEqual([{ entryId: "b", reason: "COMMUNITY" }]);
  });
  it("breaks equal timestamps deterministically without mutating input", () => {
    const input = [candidate("z"), candidate("a")];
    expect(selectShortlist(input).map((s) => s.entryId)).toEqual(["a", "z"]);
    expect(input[0].id).toBe("z");
  });
});
