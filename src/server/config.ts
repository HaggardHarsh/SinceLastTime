import { ApiError } from "./errors";

export function baseUrl() {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
export function demoMode() {
  if (process.env.DEMO_MODE === "true" && process.env.NODE_ENV === "production") {
    throw new ApiError(503, "INVALID_CONFIGURATION", "Demo mode is unavailable in production.");
  }
  return process.env.DEMO_MODE === "true";
}
export function twitchConfig() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new ApiError(
      503,
      "TWITCH_NOT_CONFIGURED",
      "Twitch sign-in is being configured. Please try again later.",
    );
  return { clientId, clientSecret, redirectUri: `${baseUrl()}/api/auth/twitch/callback` };
}
export function assertProductionConfig(force = false) {
  if (!force && process.env.NODE_ENV !== "production") return;
  if (process.env.DEMO_MODE === "true") throw new Error("Demo mode is unavailable in production.");
  twitchConfig();
  if (
    !process.env.DATABASE_URL ||
    Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64").length !== 32 ||
    !baseUrl().startsWith("https://")
  ) {
    throw new Error(
      "Production requires DATABASE_URL, TOKEN_ENCRYPTION_KEY, and an HTTPS APP_BASE_URL.",
    );
  }
}
