import { describe, expect, it } from "vitest";
import { statusInput, statusPatchInput } from "../../src/server/statuses";
import { graphemeLength } from "../../src/server/time";

describe("status input", () => {
  it("requires explicit consent for public broadcast and reminders", () => {
    expect(statusInput.parse({ body: "A small update" })).toMatchObject({
      allowOnStream: false,
      allowFollowUp: false,
    });
  });
  it("keeps omitted patch fields unchanged", () => {
    expect(statusPatchInput.parse({ expectedVersion: 3, allowOnStream: false })).toEqual({
      expectedVersion: 3,
      allowOnStream: false,
    });
  });
  it("counts composed emoji as a character", () => {
    expect(graphemeLength("👨‍👩‍👧‍👦")).toBe(1);
    expect(statusInput.safeParse({ body: "👨‍👩‍👧‍👦".repeat(280) }).success).toBe(true);
    expect(statusInput.safeParse({ body: "a".repeat(281) }).success).toBe(false);
  });
  it("rejects blank posts and arbitrary emoji payloads", () => {
    expect(statusInput.safeParse({ body: "   " }).success).toBe(false);
    expect(statusInput.safeParse({ body: "Hello", emoji: "<img src=x>" }).success).toBe(false);
  });
});
