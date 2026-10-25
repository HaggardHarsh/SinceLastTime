import { demoLogin, finishOAuth, logout, requireUser, startOAuth } from "./auth";
import { requireSameOrigin } from "./http";
import { errorResponse, fail, success } from "./errors";
import { demoMode } from "./config";
import { communityRoutes } from "./community";
import { statusRoutes } from "./statuses";
import { storyRoutes } from "./stories";

export type ApiRoute = {
  method: string;
  pattern: RegExp;
  handle: (request: Request, params: string[]) => Promise<Response>;
};

const routes: ApiRoute[] = [
  ...communityRoutes,
  ...statusRoutes,
  ...storyRoutes,
  { method: "GET", pattern: /^auth\/twitch$/, handle: startOAuth },
  { method: "GET", pattern: /^auth\/twitch\/callback$/, handle: finishOAuth },
  { method: "POST", pattern: /^auth\/logout$/, handle: logout },
  { method: "POST", pattern: /^auth\/demo$/, handle: demoLogin },
  { method: "GET", pattern: /^me$/, handle: async (request) => success({ user: await requireUser(request), demoMode: demoMode() }) },
];

export async function dispatch(request: Request) {
  try {
    requireSameOrigin(request);
    const path = new URL(request.url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    const route = routes.find((route) => route.method === request.method && route.pattern.test(path));
    if (!route) fail(404, "NOT_FOUND", "This endpoint is unavailable.");
    const matches = route.pattern.exec(path)!;
    return await route.handle(request, matches.slice(1));
  } catch (error) { return errorResponse(error); }
}
