import { describe, expect, it } from "vitest";
import { displayable } from "../../src/server/overlay";
import type { IncludedEntry } from "../../src/server/statuses";

const now = new Date("2026-10-26T12:00:00Z");
function entry(overrides: Record<string, unknown> = {}): IncludedEntry {
  return { id: "entry", body: "A little update", version: 2, approvedVersion: 2, visibility: "VISIBLE", allowOnStream: true, createdAt: new Date("2026-10-25"), expiresAt: new Date("2026-11-01"), reports: [], author: { memberships: [{ state: "ACTIVE", currentEntryId: "entry" }] }, ...overrides } as unknown as IncludedEntry;
}
describe("public overlay boundary", () => {
  it("only displays current approved content with explicit consent", () => {
    expect(displayable(entry(), true, now)).toBe(true);
    expect(displayable(entry({ allowOnStream: false }), true, now)).toBe(false);
    expect(displayable(entry({ approvedVersion: 1 }), true, now)).toBe(false);
    expect(displayable(entry({ body: null }), true, now)).toBe(false);
  });
  it("blocks hidden, reported, expired, and suspended content", () => {
    expect(displayable(entry({ visibility: "HIDDEN" }), true, now)).toBe(false);
    expect(displayable(entry({ reports: [{ id: "report" }] }), true, now)).toBe(false);
    expect(displayable(entry({ expiresAt: new Date("2026-10-26T12:00:00Z") }), true, now)).toBe(false);
    expect(displayable(entry({ author: { memberships: [{ state: "SUSPENDED", currentEntryId: "entry" }] } }), true, now)).toBe(false);
  });
  it("allows retained older context but never beyond retention", () => {
    const old = entry({ expiresAt: new Date("2026-10-20"), author: { memberships: [{ state: "ACTIVE", currentEntryId: "new-entry" }] } });
    expect(displayable(old, true, now)).toBe(false);
    expect(displayable(old, false, now)).toBe(true);
    expect(displayable(entry({ createdAt: new Date("2026-09-26") }), false, now)).toBe(false);
  });
});
