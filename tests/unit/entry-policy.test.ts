import { describe, expect, it } from "vitest";
import { unavailableReason } from "../../src/server/entry-policy";
import { encodeCursor, decodeCursor, literalSearch } from "../../src/server/pagination";
const now = new Date("2026-10-26T12:00:00Z");
const entry = {
  body: "An update",
  visibility: "VISIBLE",
  createdAt: new Date("2026-10-01"),
  author: { memberships: [{ state: "ACTIVE" }] },
};
describe("retention and pagination", () => {
  it("excludes text at the exact retention boundary even before a purge", () => {
    expect(unavailableReason(entry, now)).toBeNull();
    expect(unavailableReason({ ...entry, createdAt: new Date("2026-09-26T12:00:00Z") }, now)).toBe(
      "EXPIRED",
    );
    expect(unavailableReason({ ...entry, body: null }, now)).toBe("DELETED");
    expect(
      unavailableReason({ ...entry, author: { memberships: [{ state: "SUSPENDED" }] } }, now),
    ).toBe("MEMBER_INACTIVE");
  });
  it("binds value cursors to their query without depending on a surviving database row", () => {
    const point = { id: "11111111-1111-4111-8111-111111111111", createdAt: now };
    expect(decodeCursor(encodeCursor(point, "board:q"), "board:q")).toEqual(point);
    expect(() => decodeCursor(encodeCursor(point, "board:q"), "another-board")).toThrow();
    expect(() => decodeCursor("not a cursor", "board:q")).toThrow();
    expect(literalSearch("50%_\\")).toBe("50\\%\\_\\\\");
  });
});
