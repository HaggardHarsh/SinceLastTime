import { ApiError } from "./errors";

export function baseUrl() { return process.env.APP_BASE_URL ?? "http://localhost:3000"; }
export function demoMode() {
  if (process.env.DEMO_MODE === "true" && process.env.NODE_ENV === "production") {
    throw new ApiError(503, "INVALID_CONFIGURATION", "Demo mode is unavailable in production.");
  }
  return process.env.DEMO_MODE === "true";
}
export function twitchConfig() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new ApiError(503, "TWITCH_NOT_CONFIGURED", "Twitch sign-in is being configured. Please try again later.");
  return { clientId, clientSecret, redirectUri: `${baseUrl()}/api/auth/twitch/callback` };
}
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  demoMode();
  twitchConfig();
  if (!process.env.DATABASE_URL || !process.env.TOKEN_ENCRYPTION_KEY || !baseUrl().startsWith("https://")) {
    throw new Error("Production requires DATABASE_URL, TOKEN_ENCRYPTION_KEY, and an HTTPS APP_BASE_URL.");
  }
}
