/*
 * Notifications: one row per event and person, shown in the site's inbox (the bell), and sent on WhatsApp when the
 * person has alerts on (diners) or always (owners and staff). Events write rows; a sender delivers them in the
 * background and retries, so a WhatsApp outage never blocks a moderator's click.
 * The dedupe key makes each notification happen once, however often an event or a deadline scan runs.
 */
import { eq, inArray } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { follows, notifications, restaurantOwners, users } from "../../db/schema.js";

export type Audience = "user" | "owner" | "admin";
export interface Note {
  userId: string;
  audience: Audience;
  type: string;
  title: string;
  body: string;
  link?: string;
  key: string;
  /* also send it on WhatsApp */
  external?: boolean;
}

export async function notify(db: Queryable, list: Note | Note[]) {
  const rows = (Array.isArray(list) ? list : [list]).filter(Boolean);
  if (!rows.length) return;
  await db
    .insert(notifications)
    .values(rows.map((n) => ({ userId: n.userId, audience: n.audience, type: n.type, title: n.title.slice(0, 200), body: n.body.slice(0, 900), link: n.link ?? null, dedupeKey: n.key, external: n.external ?? false })))
    .onConflictDoNothing({ target: notifications.dedupeKey });
}

export async function ownerOf(db: Queryable, restaurantId: number | null) {
  if (!restaurantId) return null;
  const [o] = await db.select({ userId: restaurantOwners.userId }).from(restaurantOwners).where(eq(restaurantOwners.restaurantId, restaurantId)).limit(1);
  return o?.userId ?? null;
}

export async function admins(db: Queryable) {
  return (await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"))).map((u) => u.id);
}

/* people following a restaurant, with whether they asked for WhatsApp alerts */
export async function followersOf(db: Queryable, restaurantId: number, except: (string | null)[] = []) {
  const rows = await db
    .select({ id: users.id, wa: users.whatsappAlerts })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.userId))
    .where(eq(follows.restaurantId, restaurantId));
  return rows.filter((r) => !except.includes(r.id));
}

export async function alertsOn(db: Queryable, userIds: string[]) {
  if (!userIds.length) return new Map<string, boolean>();
  const rows = await db.select({ id: users.id, wa: users.whatsappAlerts }).from(users).where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r.wa]));
}

/* a diner's notification: in the inbox always, on WhatsApp if they turned alerts on */
export async function toDiner(db: Queryable, userId: string | null, n: Omit<Note, "userId" | "audience" | "external">) {
  if (!userId) return;
  const wa = (await alertsOn(db, [userId])).get(userId) ?? false;
  await notify(db, { ...n, userId, audience: "user", external: wa });
}

export const snippet = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

