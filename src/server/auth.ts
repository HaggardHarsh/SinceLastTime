import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "./db";
import { baseUrl, demoMode, twitchConfig } from "./config";
import { encrypt, hashToken, randomToken, safeEqual } from "./crypto";
import { ApiError, fail, parseBody, success } from "./errors";
import { exchangeCode, identityForToken, validateAccount, validateToken } from "./twitch";

const SESSION_COOKIE = "slt_session";
const STATE_COOKIE = "slt_oauth";
const cookieOptions = () => ({
  httpOnly: true,
  secure: baseUrl().startsWith("https://"),
  sameSite: "lax" as const,
  path: "/",
});
function requestCookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function safeReturnTo(value: string | null) {
  return value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\u0000-\u0020]/.test(value) &&
    value.length < 2048
    ? value
    : "/communities";
}

export async function currentUser(request?: Request) {
  const token = request
    ? requestCookie(request, SESSION_COOKIE)
    : (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.appSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.isDemo) return demoMode() ? session.user : null;
  await validateAccount(session.user.id);
  return session.user;
}
export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) fail(401, "SIGN_IN_REQUIRED", "Sign in with Twitch to join the conversation.");
  return user;
}

async function attachSession(response: NextResponse, userId: string) {
  const token = randomToken();
  await db.appSession.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
  });
  response.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: 7 * 86_400 });
  return response;
}

export async function startOAuth(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  let configured: ReturnType<typeof twitchConfig>;
  try {
    configured = twitchConfig();
  } catch (error) {
    if (error instanceof ApiError) return oauthFailure(returnTo, "unavailable");
    throw error;
  }
  const { clientId, redirectUri } = configured;
  const state = randomToken();
  await db.oAuthAttempt.create({
    data: { stateHash: hashToken(state), returnTo, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  const destination = new URL("https://id.twitch.tv/oauth2/authorize");
  destination.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "user:read:follows",
    state,
  }).toString();
  const response = NextResponse.redirect(destination);
  response.cookies.set(STATE_COOKIE, state, { ...cookieOptions(), maxAge: 600 });
  return response;
}

export function oauthFailure(returnTo: string, reason: "canceled" | "expired" | "unavailable") {
  const destination = new URL(safeReturnTo(returnTo), baseUrl());
  destination.searchParams.set("signin", reason);
  const response = NextResponse.redirect(destination);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function finishOAuth(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const cookieState = requestCookie(request, STATE_COOKIE);
  if (!state || !cookieState || !safeEqual(state, cookieState))
    return oauthFailure("/communities", "expired");
  const attempt = await db.oAuthAttempt.findUnique({ where: { stateHash: hashToken(state) } });
  if (!attempt || attempt.expiresAt.getTime() <= Date.now())
    return oauthFailure(attempt?.returnTo ?? "/communities", "expired");
  await db.oAuthAttempt.delete({ where: { stateHash: attempt.stateHash } });
  if (params.get("error") || !params.get("code")) return oauthFailure(attempt.returnTo, "canceled");
  try {
    const tokens = await exchangeCode(params.get("code")!);
    const validation = await validateToken(tokens.access_token);
    const identity = await identityForToken(tokens.access_token);
    if (
      !validation ||
      validation.user_id !== identity.id ||
      validation.client_id !== twitchConfig().clientId ||
      !validation.scopes.includes("user:read:follows")
    )
      fail(
        401,
        "INVALID_TWITCH_IDENTITY",
        "Please grant Twitch follower verification access and sign in again.",
      );
    const user = await db.user.upsert({
      where: { twitchId: identity.id },
      create: {
        twitchId: identity.id,
        login: identity.login,
        displayName: identity.display_name,
        avatarUrl: identity.profile_image_url,
      },
      update: {
        login: identity.login,
        displayName: identity.display_name,
        avatarUrl: identity.profile_image_url,
      },
    });
    const account = {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: validation.scopes,
      validatedAt: new Date(),
    };
    await db.oAuthAccount.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...account },
      update: account,
    });
    const response = NextResponse.redirect(new URL(safeReturnTo(attempt.returnTo), baseUrl()));
    response.cookies.delete(STATE_COOKIE);
    return await attachSession(response, user.id);
  } catch (error) {
    if (error instanceof ApiError)
      return oauthFailure(attempt.returnTo, error.status === 503 ? "unavailable" : "expired");
    throw error;
  }
}

export async function logout(request: Request) {
  const token = requestCookie(request, SESSION_COOKIE);
  if (token) await db.appSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  const response = success({ signedOut: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

export async function demoLogin(request: Request) {
  if (!demoMode()) fail(404, "NOT_FOUND", "This page is unavailable.");
  const { login } = await parseBody(request, z.object({ login: z.string().min(1).max(40) }));
  const user = await db.user.findFirst({ where: { login, isDemo: true } });
  if (!user) throw new ApiError(404, "DEMO_USER_NOT_FOUND", "Run the demo seed first.");
  return attachSession(success({ user }), user.id);
}
