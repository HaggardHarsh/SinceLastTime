import { db } from "./db";
import { validateAccount } from "./twitch";
import { ApiError } from "./errors";
import { heartbeat } from "./maintenance";
import { mapConcurrent } from "./concurrency";

const retries = new Map<string, { attempts: number; at: number }>();
export async function validateMaintainedAccounts(force = false, now = new Date()) {
  const cutoff = force ? now : new Date(now.getTime() - 55 * 60_000);
  let cursor: { userId: string; validatedAt: Date } | undefined;
  let validated = 0,
    revoked = 0,
    failed = 0,
    retryDeferred = 0;
  let lastBeat = Date.now();
  await heartbeat("oauth");
  while (true) {
    const retryIds = [...retries].filter(([, retry]) => retry.at <= Date.now()).map(([id]) => id);
    const accounts = await db.oAuthAccount.findMany({
      where: {
        user: { sessions: { some: { expiresAt: { gt: now } } } },
        AND: [
          {
            OR: [
              { validatedAt: { lt: cutoff } },
              ...(retryIds.length ? [{ userId: { in: retryIds } }] : []),
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { validatedAt: { gt: cursor.validatedAt } },
                    { validatedAt: cursor.validatedAt, userId: { gt: cursor.userId } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: { userId: true, validatedAt: true },
      orderBy: [{ validatedAt: "asc" }, { userId: "asc" }],
      take: 100,
    });
    if (!accounts.length) break;
    await mapConcurrent(accounts, 5, async (account) => {
      if ((retries.get(account.userId)?.at ?? 0) > Date.now()) {
        retryDeferred++;
        return;
      }
      try {
        await validateAccount(account.userId, true);
        retries.delete(account.userId);
        validated++;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          retries.delete(account.userId);
          revoked++;
        } else {
          const attempts = (retries.get(account.userId)?.attempts ?? 0) + 1;
          retries.set(account.userId, {
            attempts,
            at: Date.now() + Math.min(60_000, 15_000 * 2 ** Math.min(attempts - 1, 2)),
          });
          failed++;
          console.warn(
            JSON.stringify({
              event: "oauth_validation_failed",
              code:
                error instanceof ApiError
                  ? error.code
                  : error instanceof Error
                    ? error.name
                    : "UnknownError",
            }),
          );
        }
      }
      if (Date.now() - lastBeat > 10_000) {
        lastBeat = Date.now();
        await heartbeat("oauth");
      }
    });
    cursor = accounts.at(-1);
    await heartbeat("oauth");
  }
  await heartbeat("oauth");
  const overdue = await db.oAuthAccount.count({
    where: {
      user: { sessions: { some: { expiresAt: { gt: new Date() } } } },
      validatedAt: { lt: new Date(Date.now() - 60 * 60_000) },
    },
  });
  return { validated, revoked, failed, retryDeferred, overdue };
}
