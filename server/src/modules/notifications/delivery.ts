/*
 * Getting notifications out: a sender that retries, and two scans that create time-based notifications.
 *  - every 30 s: send what's waiting (WhatsApp in production, the server log in development)
 *  - every 10 min: warn staff when an item is 4 hours from its 24-hour review deadline, and when it's overdue;
 *    remind owners 2 days before evidence is due, and when it's overdue
 */
import type { FastifyBaseLogger } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import { claimRequests, evidence, notifications, reports, restaurantOwners, restaurantResponses, restaurants, users } from "../../db/schema.js";
import { daysBetween, isoDateIST } from "../../lib/dates.js";
import type { Deps } from "../../types.js";
import { loadCheckups } from "../owner/checkup-data.js";
import { freshness } from "../owner/score.js";
import { reportRef } from "../reports/dto.js";
import { admins, notify, type Note } from "./service.js";

export interface Messenger {
  send(phoneE164: string, title: string, body: string): Promise<void>;
}

/* development: the message goes to the server log */
export const consoleMessenger = (log: FastifyBaseLogger): Messenger => ({
  async send(phone, title, body) {
    log.info({ phone }, `Notification to ${phone}: ${title} · ${body}`);
  },
});

/* WhatsApp Cloud API. Business-started messages need an approved template; this one has two text parameters:
   {{1}} the title and {{2}} the details. WhatsApp refuses new lines and long runs of spaces in parameters. */
export function whatsappMessenger(c: Config): Messenger {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  return {
    async send(phone, title, body) {
      const res = await fetch(`https://graph.facebook.com/${c.WHATSAPP_API_VERSION}/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${c.WHATSAPP_TOKEN}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone.replace(/^\+/, ""),
          type: "template",
          template: {
            name: c.WHATSAPP_NOTIFY_TEMPLATE,
            language: { code: c.WHATSAPP_TEMPLATE_LANG },
            components: [{ type: "body", parameters: [{ type: "text", text: clean(title) }, { type: "text", text: clean(body) }] }],
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`WhatsApp responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    },
  };
}

export function messengerFromConfig(c: Config, log: FastifyBaseLogger): Messenger | null {
  if (c.NOTIFY_CHANNEL === "off") return null;
  return c.NOTIFY_CHANNEL === "whatsapp" ? whatsappMessenger(c) : consoleMessenger(log);
}

const MAX_ATTEMPTS = 5;

/* send up to 50 waiting notifications; each is taken by one sender only, and retried up to 5 times */
export async function deliverPending(deps: Deps, messenger: Messenger, log: FastifyBaseLogger) {
  const { db } = deps;
  const taken = await db.execute<{ id: number }>(sql`
    update ${notifications} set send_attempts = send_attempts + 1
    where id in (
      select id from ${notifications}
      where external and sent_at is null and send_attempts < ${MAX_ATTEMPTS}
      order by id limit 50 for update skip locked
    )
    returning id`);
  const ids = taken.rows.map((r) => Number(r.id));
  if (!ids.length) return 0;
  const rows = await db
    .select({ id: notifications.id, title: notifications.title, body: notifications.body, phone: users.phone })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(inArray(notifications.id, ids));
  let sent = 0;
  for (const r of rows) {
    try {
      await messenger.send(r.phone, r.title, r.body);
      await db.update(notifications).set({ sentAt: deps.now() }).where(eq(notifications.id, r.id));
      sent++;
    } catch (err) {
      log.warn({ err, notification: r.id }, "notification not sent; will retry");
    }
  }
  return sent;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WARN_BEFORE = 4 * HOUR;

/* staff: everything has a 24-hour review deadline; warn 4 hours before, and again when it's missed */
export async function scanDeadlines(deps: Deps) {
  const { db } = deps;
  const now = deps.now().getTime();
  const staff = await admins(db);
  if (!staff.length) return 0;
  const since = new Date(now - 30 * DAY);
  const items: { kind: string; id: string | number; created: Date; what: string }[] = [];
  const reps = await db
    .select({ id: reports.id, at: reports.createdAt, name: restaurants.name, unlisted: reports.unlistedName })
    .from(reports)
    .leftJoin(restaurants, eq(restaurants.id, reports.restaurantId))
    .where(and(eq(reports.status, "pending"), sql`${reports.createdAt} > ${since}`));
  for (const r of reps) items.push({ kind: "report", id: r.id, created: r.at, what: `Report ${reportRef(r.id)} about ${r.name ?? r.unlisted}` });
  const evs = await db
    .select({ id: evidence.id, at: evidence.createdAt, name: restaurants.name, req: evidence.requirementId })
    .from(evidence)
    .innerJoin(restaurants, eq(restaurants.id, evidence.restaurantId))
    .where(and(eq(evidence.status, "submitted"), sql`${evidence.createdAt} > ${since}`));
  for (const e of evs) items.push({ kind: "evidence", id: e.id, created: e.at, what: `Evidence (${e.req}) from ${e.name}` });
  const proofs = await db
    .select({ id: restaurantResponses.reportId, at: restaurantResponses.createdAt, name: restaurants.name })
    .from(restaurantResponses)
    .innerJoin(reports, eq(reports.id, restaurantResponses.reportId))
    .innerJoin(restaurants, eq(restaurants.id, reports.restaurantId))
    .where(and(eq(restaurantResponses.status, "pending"), sql`${restaurantResponses.createdAt} > ${since}`));
  for (const p of proofs) items.push({ kind: "proof", id: p.id, created: p.at, what: `${p.name}'s proof on ${reportRef(p.id)}` });
  const claims = await db
    .select({ id: claimRequests.id, at: claimRequests.createdAt, name: restaurants.name })
    .from(claimRequests)
    .innerJoin(restaurants, eq(restaurants.id, claimRequests.restaurantId))
    .where(and(eq(claimRequests.status, "pending"), sql`${claimRequests.createdAt} > ${since}`));
  for (const c of claims) items.push({ kind: "claim", id: c.id, created: c.at, what: `The claim for ${c.name}` });

  const notes: Note[] = [];
  for (const it of items) {
    const due = it.created.getTime() + DAY;
    const stage = now >= due ? "overdue" : now >= due - WARN_BEFORE ? "soon" : null;
    if (!stage) continue;
    const hours = Math.max(1, Math.ceil((due - now) / HOUR));
    for (const a of staff) {
      notes.push({
        userId: a,
        audience: "admin",
        type: `deadline.${stage}`,
        title: stage === "overdue" ? `Overdue: ${it.what}` : `Due in ${hours} h: ${it.what}`,
        body: stage === "overdue" ? "It passed its 24-hour review deadline. Please check it now." : "It reaches its 24-hour review deadline soon.",
        link: "#admin",
        key: `deadline:${it.kind}:${it.id}:${stage}:${a}`,
        external: true,
      });
    }
  }
  await notify(db, notes);
  return notes.length;
}

/* owners: evidence due within 2 days, and overdue evidence, per part of the checkup */
export async function scanDue(deps: Deps) {
  const { db } = deps;
  const today = isoDateIST(deps.now());
  const owners = await db.select({ rid: restaurantOwners.restaurantId, userId: restaurantOwners.userId }).from(restaurantOwners);
  if (!owners.length) return 0;
  const cks = await loadCheckups(db, owners.map((o) => o.rid), today);
  const names = new Map((await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants).where(inArray(restaurants.id, owners.map((o) => o.rid)))).map((r) => [r.id, r.name]));
  const notes: Note[] = [];
  for (const o of owners) {
    for (const f of freshness(cks.get(o.rid)!.checkup)) {
      if (!f.dueOn) continue;
      const what = f.key === "pest" || f.key === "docs" ? "PDF" : "photos";
      const left = daysBetween(today, f.dueOn);
      if (f.state === "expired") {
        notes.push({ userId: o.userId, audience: "owner", type: "evidence.overdue", title: `${f.name} is overdue at ${names.get(o.rid)}`, body: `New ${what} were due by ${f.dueOn}. Until you upload them, those items don't count and your public profile shows them as overdue.`, link: "#dashboard", key: `overdue:${o.rid}:${f.key}:${f.dueOn}`, external: true });
      } else if (left >= 0 && left <= 2) {
        notes.push({ userId: o.userId, audience: "owner", type: "evidence.due", title: `${f.name} ${what} due ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`}`, body: `Upload new ${what} for ${names.get(o.rid)} by ${f.dueOn} to keep your score.`, link: "#dashboard", key: `due:${o.rid}:${f.key}:${f.dueOn}`, external: true });
      }
    }
  }
  await notify(db, notes);
  return notes.length;
}

export function scheduleNotifications(deps: Deps, log: FastifyBaseLogger) {
  const messenger = messengerFromConfig(deps.config, log);
  const safe = (name: string, fn: () => Promise<unknown>) => () => void fn().catch((err) => log.error({ err }, `${name} failed`));
  const scan = safe("notification scan", async () => {
    await scanDeadlines(deps);
    await scanDue(deps);
  });
  const send = safe("notification delivery", async () => messenger && (await deliverPending(deps, messenger, log)));
  scan();
  const a = setInterval(scan, 10 * 60_000);
  const b = setInterval(send, 30_000);
  a.unref();
  b.unref();
  return () => (clearInterval(a), clearInterval(b));
}
