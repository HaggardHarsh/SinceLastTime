import { baseUrl } from "./config";
import { fail } from "./errors";
import { db } from "./db";
import { ApiError } from "./errors";

export function requireSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("origin") !== new URL(baseUrl()).origin) fail(403, "INVALID_ORIGIN", "Please refresh this page before trying again.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail(400, "INVALID_CONTENT_TYPE", "Please send JSON.");
}

export async function rateLimit(actorId: string, action: string, limit: number, windowMs: number) {
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const expiresAt = new Date((window + 1) * windowMs);
  const key = `${actorId}:${action}:${window}`;
  const bucket = await db.rateLimitBucket.upsert({ where: { key }, create: { key, expiresAt }, update: { count: { increment: 1 } } });
  if (bucket.count > limit) throw new ApiError(429, "RATE_LIMITED", "You’re doing that a little quickly. Please try again shortly.", Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)));
}
