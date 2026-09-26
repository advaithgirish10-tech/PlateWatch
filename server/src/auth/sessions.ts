import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import type { Deps, SessionMode, SessionUser } from "../types.js";

export const SESSION_COOKIE = "pw_session";
export const OWNER_COOKIE = "pw_owner";
export const cookieFor = (mode: SessionMode) => (mode === "owner" ? OWNER_COOKIE : SESSION_COOKIE);
/* each tab says which login it uses; the header can't be set by another site without CORS, which the API doesn't allow */
export const modeOf = (req: FastifyRequest): SessionMode => (req.headers["x-pw-mode"] === "owner" ? "owner" : "user");
const TTL_MS = 30 * 86_400_000;
const TOUCH_MS = 3_600_000;

export async function createSession(db: DB, userId: string, meta: { ip: string; userAgent?: string; now: Date; mode: SessionMode }) {
  const token = randomToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    kind: meta.mode,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300),
    expiresAt: new Date(meta.now.getTime() + TTL_MS),
  });
  return { token, maxAgeSeconds: TTL_MS / 1000 };
}

export async function sessionUser(db: DB, token: string, now: Date, mode: SessionMode = "user"): Promise<SessionUser | null> {
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now), eq(sessions.kind, mode), isNull(users.bannedAt)))
    .limit(1);
  if (!row) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > TOUCH_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id));
  }
  const { u } = row;
  return { id: u.id, phone: u.phone, name: u.name, role: u.role, whatsappAlerts: u.whatsappAlerts, phoneVerifiedAt: u.phoneVerifiedAt, sessionId: row.s.id, mode };
}

export function setSessionCookie(deps: Deps, reply: FastifyReply, token: string, maxAge: number, mode: SessionMode = "user") {
  reply.setCookie(cookieFor(mode), token, {
    httpOnly: true,
    secure: deps.config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export function clearSessionCookie(reply: FastifyReply, mode?: SessionMode) {
  for (const m of mode ? [mode] : (["user", "owner"] as const)) reply.clearCookie(cookieFor(m), { path: "/" });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/* the restaurant dashboard: an owner login (from the owner tab), or PlateWatch staff */
export function requireOwnerLogin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.mode !== "owner" && u.role !== "admin") throw forbidden("Open the restaurant dashboard from the owner login. It runs in its own tab.");
  return u;
}

/* reports, follows and alerts belong to the diner login */
export function requireUserLogin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.mode !== "user") throw forbidden("Reports are sent from a user login. Open PlateWatch in another tab to report.");
  return u;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== "admin") throw forbidden();
  return u;
}
