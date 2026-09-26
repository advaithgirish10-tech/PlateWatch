import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions } from "fastify";
import { cookieFor, modeOf, sessionUser } from "./auth/sessions.js";
import { authRoutes } from "./auth/routes.js";
import { HttpError, forbidden } from "./lib/errors.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { meRoutes } from "./modules/me/routes.js";
import { ownerRoutes } from "./modules/owner/routes.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { restaurantRoutes } from "./modules/restaurants/routes.js";
import { uploadRoutes } from "./modules/uploads/routes.js";
import { devStorageRoutes } from "./storage/dev-routes.js";
import type { Deps } from "./types.js";

/* rateLimit: false only in tests, which sign in many numbers from one address; the OTP limits in the database still apply */
export async function buildApp(deps: Deps, { rateLimit: limit = true, ...opts }: FastifyServerOptions & { rateLimit?: boolean } = {}) {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 64 * 1024,
    logger: deps.config.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
    ...opts,
  });
  app.decorate("deps", deps);
  app.decorateRequest("user", null);

  await app.register(cookie);
  if (limit) await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  /* browsers send Origin on every state-changing request; refuse ones from other sites (CSRF) */
  const allowed = new Set(deps.config.ALLOWED_ORIGINS);
  app.addHook("onRequest", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin) && origin !== `${req.protocol}://${req.host}`) throw forbidden("Requests from other sites aren't allowed.");
  });

  app.addHook("onRequest", async (req) => {
    const mode = modeOf(req);
    const token = req.cookies[cookieFor(mode)];
    if (token) req.user = await sessionUser(deps.db, token, deps.now(), mode);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.status === 429 && err.details && typeof err.details === "object" && "retryAfterSeconds" in err.details) {
        reply.header("retry-after", String((err.details as { retryAfterSeconds: number }).retryAfterSeconds));
      }
      return reply.status(err.status).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: e.code ?? "BAD_REQUEST", message: e.message ?? "Bad request." });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: "INTERNAL", message: "Something went wrong on our side. Try again." });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: "NOT_FOUND", message: "Not found." }));

  app.get("/api/health", async () => {
    await deps.db.execute("select 1");
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(restaurantRoutes);
  await app.register(uploadRoutes);
  await app.register(ownerRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);
  if (deps.config.STORAGE !== "s3" && deps.config.NODE_ENV !== "production") await app.register(devStorageRoutes);

  return app;
}
