import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { twitchConfig } from "./config";
import { ApiError } from "./errors";

export type TwitchIdentity = { id: string; login: string; display_name: string; profile_image_url: string };
type TwitchValidation = { client_id: string; user_id: string; scopes: string[]; expires_in: number };
type TwitchTokens = { access_token: string; refresh_token: string; expires_in: number; scope: string[] };

async function fetchTwitch(url: string, init?: RequestInit) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" }); }
  catch { throw new ApiError(503, "TWITCH_UNAVAILABLE", "Twitch is taking a moment. Please try again.", 15); }
}

export async function exchangeCode(code: string): Promise<TwitchTokens> {
  const { clientId, clientSecret, redirectUri } = twitchConfig();
  const response = await fetchTwitch("https://id.twitch.tv/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }) });
  if (!response.ok) throw new ApiError(401, "TWITCH_AUTH_FAILED", "Twitch sign-in expired. Please start again.");
  return response.json();
}

export async function validateToken(token: string): Promise<TwitchValidation | null> {
  const response = await fetchTwitch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${token}` } });
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError(503, "TWITCH_UNAVAILABLE", "Twitch verification is temporarily unavailable.", 15);
  return response.json();
}

export async function identityForToken(token: string): Promise<TwitchIdentity> {
  const { clientId } = twitchConfig();
  const response = await fetchTwitch("https://api.twitch.tv/helix/users", { headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId } });
  if (!response.ok) throw new ApiError(401, "TWITCH_AUTH_FAILED", "Please reconnect your Twitch account.");
  const body = await response.json() as { data: TwitchIdentity[] };
  if (!body.data[0]) throw new ApiError(401, "TWITCH_AUTH_FAILED", "Twitch could not verify your account.");
  return body.data[0];
}

async function invalidateAccount(userId: string): Promise<never> {
  await db.$transaction([
    db.appSession.deleteMany({ where: { userId } }),
    db.oAuthAccount.deleteMany({ where: { userId } }),
    db.membership.updateMany({ where: { userId, role: { not: "OWNER" } }, data: { followCheckedAt: null } }),
  ]);
  throw new ApiError(401, "SESSION_EXPIRED", "Please sign in with Twitch again.");
}

async function refreshAccount(userId: string, failedToken: string) {
  const { clientId, clientSecret } = twitchConfig();
  const refreshed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const account = await tx.oAuthAccount.findUnique({ where: { userId } });
    if (!account) return null;
    const existingToken = decrypt(account.accessTokenEnc);
    if (existingToken !== failedToken) return existingToken;
    const response = await fetchTwitch("https://id.twitch.tv/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: decrypt(account.refreshTokenEnc) }) });
    if (response.status === 400 || response.status === 401) return null;
    if (!response.ok) throw new ApiError(503, "TWITCH_UNAVAILABLE", "Twitch sign-in is temporarily unavailable.", 15);
    const tokens = await response.json() as TwitchTokens;
    const validation = await validateToken(tokens.access_token);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!validation || validation.user_id !== user.twitchId || validation.client_id !== clientId || !validation.scopes.includes("user:read:follows")) return null;
    await tx.oAuthAccount.update({ where: { userId }, data: { accessTokenEnc: encrypt(tokens.access_token), refreshTokenEnc: encrypt(tokens.refresh_token), expiresAt: new Date(Date.now() + tokens.expires_in * 1000), scopes: validation.scopes, validatedAt: new Date() } });
    return tokens.access_token;
  }, { timeout: 30_000, maxWait: 10_000 });
  return refreshed ?? invalidateAccount(userId);
}

export async function validateAccount(userId: string, force = false) {
  const account = await db.oAuthAccount.findUnique({ where: { userId } });
  if (!account) return invalidateAccount(userId);
  if (!force && Date.now() - account.validatedAt.getTime() < 55 * 60_000) return;
  const token = decrypt(account.accessTokenEnc);
  const validation = await validateToken(token);
  if (!validation) {
    if (account.expiresAt.getTime() <= Date.now()) { await refreshAccount(userId, token); return; }
    return invalidateAccount(userId);
  }
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (validation.client_id !== twitchConfig().clientId || validation.user_id !== user.twitchId || !validation.scopes.includes("user:read:follows")) return invalidateAccount(userId);
  await db.oAuthAccount.update({ where: { userId }, data: { validatedAt: new Date() } });
}

export async function followsChannel(userId: string, broadcasterId: string): Promise<boolean> {
  const account = await db.oAuthAccount.findUnique({ where: { userId }, include: { user: true } });
  if (!account) return invalidateAccount(userId);
  const { clientId } = twitchConfig();
  const url = `https://api.twitch.tv/helix/channels/followed?${new URLSearchParams({ user_id: account.user.twitchId, broadcaster_id: broadcasterId })}`;
  let token = decrypt(account.accessTokenEnc);
  let response = await fetchTwitch(url, { headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId } });
  if (response.status === 401) {
    token = await refreshAccount(userId, token);
    response = await fetchTwitch(url, { headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId } });
  }
  if (response.status === 401) return invalidateAccount(userId);
  if (!response.ok) throw new ApiError(503, "FOLLOW_CHECK_UNAVAILABLE", "We couldn’t check your follow just now. Please try again.", 15);
  const body = await response.json() as { data: { broadcaster_id: string }[] };
  return body.data.some((channel) => channel.broadcaster_id === broadcasterId);
}
