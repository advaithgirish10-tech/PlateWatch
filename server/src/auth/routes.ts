import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessions } from "../db/schema.js";
import { parse } from "../lib/validate.js";
import { requestOtp, verifyOtp } from "./otp.js";
import { clearSessionCookie, createSession, setSessionCookie } from "./sessions.js";
import { userDto } from "../modules/me/dto.js";

const RequestBody = z.object({ phone: z.string().max(20) });
const VerifyBody = z.object({ phone: z.string().max(20), code: z.string().max(12), consent: z.boolean().optional() });

export async function authRoutes(app: FastifyInstance) {
  const { deps } = app;

  app.post("/api/auth/otp/request", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    const body = parse(RequestBody, req.body);
    return requestOtp(deps, { phone: body.phone, ip: req.ip });
  });

  app.post("/api/auth/otp/verify", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = parse(VerifyBody, req.body);
    const user = await verifyOtp(deps, body);
    const { token, maxAgeSeconds } = await createSession(deps.db, user.id, { ip: req.ip, userAgent: req.headers["user-agent"], now: deps.now() });
    setSessionCookie(deps, reply, token, maxAgeSeconds);
    return { user: await userDto(deps.db, user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.user) await deps.db.delete(sessions).where(eq(sessions.id, req.user.sessionId));
    clearSessionCookie(reply);
    return reply.status(204).send();
  });
}
