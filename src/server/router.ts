import { demoLogin, finishOAuth, logout, requireUser, startOAuth } from "./auth";
import { requireSameOrigin } from "./http";
import { errorResponse, fail, success } from "./errors";
import { demoMode } from "./config";
import { communityRoutes } from "./community";
import { statusRoutes } from "./statuses";
import { storyRoutes } from "./stories";
import { interactionRoutes } from "./interactions";
import { moderationRoutes } from "./moderation";
import { segmentRoutes } from "./segments";
import { overlayRoutes } from "./overlay";
import { followUpRoutes } from "./followups";
import { db } from "./db";
import { ownedStatusRoutes } from "./owned-statuses";
import { candidateRoutes } from "./candidates";
import { acknowledgementRoutes } from "./acknowledgements";
import { briefingRoutes } from "./briefing";
import { setupRoutes } from "./setup";

export type ApiRoute = {
  method: string;
  pattern: RegExp;
  handle: (request: Request, params: string[]) => Promise<Response>;
};

const routes: ApiRoute[] = [
  ...ownedStatusRoutes,
  ...candidateRoutes,
  ...acknowledgementRoutes,
  ...briefingRoutes,
  ...setupRoutes,
  ...communityRoutes,
  ...statusRoutes,
  ...storyRoutes,
  ...interactionRoutes,
  ...moderationRoutes,
  ...segmentRoutes,
  ...overlayRoutes,
  ...followUpRoutes,
  { method: "GET", pattern: /^health$/, handle: async () => success({ ok: true }) },
  {
    method: "GET",
    pattern: /^readiness$/,
    handle: async () => {
      await db.$queryRaw`SELECT 1`;
      const heartbeats = await db.workerHeartbeat.findMany({
        where: { name: { in: ["maintenance", "oauth"] } },
      });
      const healthy = (name: string) =>
        heartbeats.some(
          (heartbeat) =>
            heartbeat.name === name && Date.now() - heartbeat.lastSeenAt.getTime() < 180_000,
        );
      const maintenance = healthy("maintenance"),
        oauth = healthy("oauth");
      const workerHealthy = maintenance && oauth;
      if (process.env.NODE_ENV === "production" && !workerHealthy)
        fail(503, "WORKER_UNAVAILABLE", "Background worker is starting.");
      const overdueAccounts = await db.oAuthAccount.count({
        where: {
          user: { sessions: { some: { expiresAt: { gt: new Date() } } } },
          validatedAt: { lt: new Date(Date.now() - 60 * 60_000) },
        },
      });
      return success({
        database: true,
        worker: workerHealthy,
        maintenance,
        oauth,
        overdueAccounts,
      });
    },
  },
  { method: "GET", pattern: /^auth\/twitch$/, handle: startOAuth },
  { method: "GET", pattern: /^auth\/twitch\/callback$/, handle: finishOAuth },
  { method: "POST", pattern: /^auth\/logout$/, handle: logout },
  { method: "POST", pattern: /^auth\/demo$/, handle: demoLogin },
  {
    method: "GET",
    pattern: /^me$/,
    handle: async (request) => success({ user: await requireUser(request), demoMode: demoMode() }),
  },
];

export async function dispatch(request: Request) {
  try {
    requireSameOrigin(request);
    const path = new URL(request.url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    const route = routes.find(
      (route) => route.method === request.method && route.pattern.test(path),
    );
    if (!route) fail(404, "NOT_FOUND", "This endpoint is unavailable.");
    const matches = route.pattern.exec(path)!;
    return await route.handle(request, matches.slice(1));
  } catch (error) {
    return errorResponse(error);
  }
}
