import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertProductionConfig } from "../../src/server/config";
import { startOAuth } from "../../src/server/auth";

describe("production configuration", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("APP_BASE_URL", "https://sincelasttime.example.com");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("TWITCH_CLIENT_ID", "test-client");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "test-only-secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());
  it("accepts a complete HTTPS configuration", () =>
    expect(() => assertProductionConfig(true)).not.toThrow());
  it("reports an unconfigured preview accurately without starting an OAuth request", async () => {
    vi.stubEnv("TWITCH_CLIENT_SECRET", "");
    const response = await startOAuth(
      new Request("https://sincelasttime.example.com/api/auth/twitch?returnTo=%2Fc%2Fluna"),
    );
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/c/luna");
    expect(destination.searchParams.get("signin")).toBe("unconfigured");
  });
  it("refuses demo authentication in production even when invoked from npm prestart", () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect(() => assertProductionConfig(true)).toThrow("Demo mode");
  });
  it("requires a real encryption key and HTTPS origin", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "short");
    expect(() => assertProductionConfig(true)).toThrow();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    expect(() => assertProductionConfig(true)).toThrow();
  });
});
