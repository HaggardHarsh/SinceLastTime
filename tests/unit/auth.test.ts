import { describe, expect, it, beforeEach } from "vitest";
import { decrypt, encrypt, hashToken, randomToken, safeEqual } from "../../src/server/crypto";
import { safeReturnTo } from "../../src/server/auth";
import { requireSameOrigin } from "../../src/server/http";

describe("authentication boundaries", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  it("encrypts credentials with authenticated, randomized ciphertext", () => {
    const first = encrypt("test-only-token");
    expect(first).not.toContain("test-only-token");
    expect(first).not.toEqual(encrypt("test-only-token"));
    expect(decrypt(first)).toBe("test-only-token");
    const parts = first.split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("generates unique opaque session tokens and stable hashes", () => {
    const token = randomToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(randomToken()).not.toEqual(token);
    expect(hashToken(token)).toHaveLength(64);
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual(token, token + "x")).toBe(false);
  });

  it.each(["https://example.com", "//example.com", "/\\example.com", "/\t/example.com", "/\n/example.com", null])("rejects unsafe return destination %s", (destination) => {
    expect(safeReturnTo(destination)).toBe("/communities");
  });

  it("allows a relative community return destination", () => {
    expect(safeReturnTo("/c/luna?tab=history")).toBe("/c/luna?tab=history");
  });

  it("requires same-origin JSON mutations", () => {
    expect(() => requireSameOrigin(new Request("http://localhost:3000/api/communities", { method: "POST", headers: { origin: "https://elsewhere.example", "content-type": "application/json" } }))).toThrow();
    expect(() => requireSameOrigin(new Request("http://localhost:3000/api/communities", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" } }))).not.toThrow();
  });
});
