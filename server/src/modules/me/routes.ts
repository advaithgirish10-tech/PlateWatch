import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearSessionCookie, requireUser } from "../../auth/sessions.js";
import { follows, otpChallenges, restaurants, users, watchedAreas } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { isoDateIST } from "../../lib/dates.js";
import { notFound } from "../../lib/errors.js";
import { cleanText, idParam, parse } from "../../lib/validate.js";
import { badgesFor } from "../owner/checkup-data.js";
import { dotOf } from "../restaurants/service.js";
import { userDto } from "./dto.js";

const Patch = z.object({ name: cleanText(60).optional(), whatsappAlerts: z.boolean().optional() });
const Area = z.object({ area: cleanText(80).pipe(z.string().min(2)) });

export async function meRoutes(app: FastifyInstance) {
  const { deps } = app;
  const { db } = deps;

  /* logged out is not an error here: the site asks this on every load */
  app.get("/api/me", async (req) => ({ user: req.user ? await userDto(db, req.user) : null }));

  app.patch("/api/me", async (req) => {
    const me = requireUser(req);
    const body = parse(Patch, req.body);
    const [u] = await db
      .update(users)
      .set({ ...(body.name !== undefined ? { name: body.name || null } : {}), ...(body.whatsappAlerts !== undefined ? { whatsappAlerts: body.whatsappAlerts } : {}) })
      .where(eq(users.id, me.id))
      .returning();
    return { user: await userDto(db, u!) };
  });

  /* "Delete my data": the account, sessions, follows and areas go; reports stay, without the reporter */
  app.delete("/api/me", async (req, reply) => {
    const me = requireUser(req);
    await db.transaction(async (tx) => {
      await tx.delete(otpChallenges).where(eq(otpChallenges.phone, me.phone));
      await tx.delete(users).where(eq(users.id, me.id));
      await audit(tx, { actorId: me.id, action: "user.delete", entityType: "user", entityId: me.id });
    });
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/api/me/follows", async (req) => {
    const me = requireUser(req);
    const rows = await db
      .select({ r: restaurants })
      .from(follows)
      .innerJoin(restaurants, eq(restaurants.id, follows.restaurantId))
      .where(eq(follows.userId, me.id))
      .orderBy(asc(follows.createdAt));
    const badges = await badgesFor(db, rows.map((x) => x.r.id), isoDateIST(deps.now()));
    return {
      items: rows.map(({ r }) => ({ id: r.id, name: r.name, area: r.area, city: r.city, status: r.currentStatus, dot: dotOf(r.currentStatus), badge: badges.get(r.id) })),
    };
  });

  app.put("/api/me/follows/:id", async (req, reply) => {
    const me = requireUser(req);
    const { id } = parse(idParam, req.params);
    const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!r) throw notFound("No restaurant with that ID.");
    await db.insert(follows).values({ userId: me.id, restaurantId: id }).onConflictDoNothing();
    return reply.status(204).send();
  });

  app.delete("/api/me/follows/:id", async (req, reply) => {
    const me = requireUser(req);
    const { id } = parse(idParam, req.params);
    await db.delete(follows).where(and(eq(follows.userId, me.id), eq(follows.restaurantId, id)));
    return reply.status(204).send();
  });

  app.get("/api/me/areas", async (req) => {
    const me = requireUser(req);
    const rows = await db.select().from(watchedAreas).where(eq(watchedAreas.userId, me.id)).orderBy(asc(watchedAreas.createdAt));
    const names = rows.map((a) => a.area.toLowerCase());
    /* how many places with an official action each watched area has */
    const counts = names.length
      ? await db
          .select({ area: sql<string>`lower(${restaurants.area})`, n: sql<number>`count(*)::int` })
          .from(restaurants)
          .where(and(inArray(sql`lower(${restaurants.area})`, names), sql`${restaurants.currentStatus} is not null`))
          .groupBy(sql`lower(${restaurants.area})`)
      : [];
    return { items: rows.map((a) => ({ id: a.id, area: a.area, actions: counts.find((c) => c.area === a.area.toLowerCase())?.n ?? 0 })) };
  });

  app.post("/api/me/areas", async (req, reply) => {
    const me = requireUser(req);
    const { area } = parse(Area, req.body);
    const [row] = await db.insert(watchedAreas).values({ userId: me.id, area }).onConflictDoNothing().returning();
    return reply.status(row ? 201 : 200).send({ id: row?.id ?? null, area });
  });

  app.delete("/api/me/areas/:id", async (req, reply) => {
    const me = requireUser(req);
    const { id } = parse(idParam, req.params);
    await db.delete(watchedAreas).where(and(eq(watchedAreas.id, id), eq(watchedAreas.userId, me.id)));
    return reply.status(204).send();
  });
}
