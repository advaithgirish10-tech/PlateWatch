import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  correctionRequests,
  enforcementActions,
  evidence,
  placeSuggestions,
  reportEvidence,
  reports,
  restaurantOwners,
  restaurantResponses,
  restaurants,
} from "../../db/schema.js";
import { isoDateIST } from "../../lib/dates.js";
import { notFound } from "../../lib/errors.js";
import { cleanText, idParam, parse } from "../../lib/validate.js";
import { badgesFor, loadCheckups } from "../owner/checkup-data.js";
import { freshness, grade, score } from "../owner/score.js";
import { PUBLIC_REPORT_DAYS, publicUntil, reportRef } from "../reports/dto.js";
import { dotOf, isOpenAction, likeEscape, summaryLine, type ActionType } from "./service.js";

/* how long an approved kitchen photo stays in the public gallery */
const GALLERY_DAYS = 30;

const ListQuery = z.object({
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, "bbox is minLng,minLat,maxLng,maxLat")
    .optional(),
  q: z.string().trim().max(100).optional(),
  city: z.string().max(60).optional(),
  status: z.enum(["red", "amber", "green", "grey"]).optional(),
  badge: z.enum(["verified", "claimed", "none"]).optional(),
  licence: z.enum(["active", "inactive", "unchecked"]).optional(),
  sort: z.enum(["new", "old"]).default("new"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
const SearchQuery = z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(100) });
const Correction = z.object({ role: z.enum(["owner", "customer", "other"]), message: cleanText(1000).pipe(z.string().min(5)) });
const Suggestion = z.object({ name: cleanText(120).pipe(z.string().min(2)), area: cleanText(120).pipe(z.string().min(2)) });

const STATUS_SQL: Record<string, SQL> = {
  red: sql`${restaurants.currentStatus} in ('sus','rev')`,
  amber: sql`${restaurants.currentStatus} = 'imp'`,
  green: sql`${restaurants.currentStatus} = 'ok'`,
  grey: sql`${restaurants.currentStatus} is null`,
};

/* substring match on name, area, city, category or licence, plus typo tolerance on words (not on licence numbers) */
const matches = (q: string) => {
  const substring = sql`${restaurants.searchText} ilike ${"%" + likeEscape(q.toLowerCase()) + "%"}`;
  return /^\d+$/.test(q) ? substring : sql`(${substring} or ${q.toLowerCase()} <% ${restaurants.searchText})`;
};

type Row = typeof restaurants.$inferSelect;
const card = (r: Row, badge: { level: string; paused?: string[] } | undefined, summary?: string) => ({
  id: r.id,
  name: r.name,
  area: r.area,
  city: r.city,
  category: r.category,
  licenceNumber: r.licenceNumber,
  /* as FSSAI's FoSCoS search showed it to staff on licenceCheckedOn; null = not checked yet */
  licenceStatus: r.licenceStatus,
  licenceCheckedOn: r.licenceCheckedOn,
  source: r.source,
  location: r.location ? { lat: r.location.y, lng: r.location.x } : null,
  status: r.currentStatus,
  statusOn: r.currentStatusOn,
  dot: dotOf(r.currentStatus),
  badge: badge ?? { level: "none" },
  lastVerifiedOn: r.lastVerifiedOn,
  ...(summary ? { summary } : {}),
});

export async function restaurantRoutes(app: FastifyInstance) {
  const { deps } = app;
  const { db } = deps;
  const today = () => isoDateIST(deps.now());

  /* the plain summary sentence for each restaurant, from its official history (one query for all of them) */
  async function summariesFor(rows: Row[]) {
    const out = new Map<number, string>();
    if (!rows.length) return out;
    const hist = await db
      .select({ restaurantId: enforcementActions.restaurantId, actionOn: enforcementActions.actionOn, type: enforcementActions.type, authority: enforcementActions.authority })
      .from(enforcementActions)
      .where(inArray(enforcementActions.restaurantId, rows.map((r) => r.id)))
      .orderBy(asc(enforcementActions.actionOn), asc(enforcementActions.id));
    for (const r of rows) out.set(r.id, summaryLine(hist.filter((h) => h.restaurantId === r.id).map((h) => ({ ...h, type: h.type as ActionType })), r.lastVerifiedOn));
    return out;
  }

  /* the tracker map and results panel */
  app.get("/api/restaurants", async (req) => {
    const q = parse(ListQuery, req.query);
    const where: SQL[] = [];
    if (q.bbox) {
      const [minLng, minLat, maxLng, maxLat] = q.bbox.split(",").map(Number);
      where.push(sql`${restaurants.location} && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`);
    }
    if (q.q) where.push(matches(q.q));
    if (q.city) where.push(eq(restaurants.city, q.city));
    if (q.status) where.push(STATUS_SQL[q.status]!);
    if (q.licence === "active") where.push(eq(restaurants.licenceStatus, "active"));
    if (q.licence === "inactive") where.push(inArray(restaurants.licenceStatus, ["inactive", "not_found"]));
    if (q.licence === "unchecked") where.push(isNull(restaurants.licenceStatus));
    const order = q.sort === "new" ? sql`${restaurants.currentStatusOn} desc nulls last, ${restaurants.name}` : sql`${restaurants.currentStatusOn} asc nulls last, ${restaurants.name}`;
    /* the badge is computed, so with a badge filter we filter before paging */
    const rows = await db
      .select()
      .from(restaurants)
      .where(where.length ? and(...where) : undefined)
      .orderBy(order)
      .limit(q.badge ? 2000 : q.limit)
      .offset(q.badge ? 0 : q.offset);
    const badges = await badgesFor(db, rows.map((r) => r.id), today());
    const summaries = await summariesFor(rows);
    let items = rows.map((r) => card(r, badges.get(r.id), summaries.get(r.id)));
    if (q.badge) items = items.filter((i) => i.badge.level === q.badge).slice(q.offset, q.offset + q.limit);
    /* inside a map view: how many matches have no map location yet (the results panel mentions them) */
    let unlocated = 0;
    if (q.bbox) {
      const rest = where.slice(1);
      const [n] = await db.select({ n: count() }).from(restaurants).where(and(isNull(restaurants.location), ...rest));
      unlocated = n?.n ?? 0;
    }
    return { items, unlocated };
  });

  /* the homepage ticker: the latest official actions */
  app.get("/api/actions/latest", async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(30).default(10) }), req.query);
    const rows = await db
      .select({ a: enforcementActions, name: restaurants.name, area: restaurants.area, city: restaurants.city })
      .from(enforcementActions)
      .innerJoin(restaurants, eq(restaurants.id, enforcementActions.restaurantId))
      .orderBy(desc(enforcementActions.actionOn), desc(enforcementActions.id))
      .limit(limit);
    return { items: rows.map(({ a, name, area, city }) => ({ restaurantId: a.restaurantId, name, area, city, type: a.type, actionOn: a.actionOn })) };
  });

  /* every city with a restaurant, for the tracker's city filter */
  app.get("/api/cities", async () => {
    const rows = await db.selectDistinct({ city: restaurants.city }).from(restaurants).orderBy(asc(restaurants.city));
    return { items: rows.map((r) => r.city) };
  });

  /* instant search: up to 6 suggestions, prefix matches on the name first */
  app.get("/api/search", async (req) => {
    const { q } = parse(SearchQuery, req.query);
    const lq = q.toLowerCase();
    const rows = await db
      .select()
      .from(restaurants)
      .where(matches(q))
      .orderBy(
        sql`(lower(${restaurants.name}) like ${likeEscape(lq) + "%"}) desc`,
        sql`word_similarity(${lq}, ${restaurants.searchText}) desc`,
        asc(restaurants.name),
      )
      .limit(6);
    const badges = await badgesFor(db, rows.map((r) => r.id), today());
    return { items: rows.map((r) => card(r, badges.get(r.id))) };
  });

  /* homepage numbers */
  app.get("/api/stats", async () => {
    const [t] = await db.select({ tracked: count(), cities: countDistinct(restaurants.city) }).from(restaurants);
    const [s] = await db.select({ n: count() }).from(restaurants).where(eq(restaurants.currentStatus, "sus"));
    const [i] = await db.select({ n: countDistinct(enforcementActions.restaurantId) }).from(enforcementActions).where(eq(enforcementActions.type, "imp"));
    return { tracked: t?.tracked ?? 0, improvementNotices: i?.n ?? 0, suspended: s?.n ?? 0, cities: t?.cities ?? 0 };
  });

  /* the public profile: official record, compliance (when claimed), kitchen gallery, published reports */
  app.get("/api/restaurants/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!r) throw notFound("No restaurant with that ID.");
    const history = await db
      .select()
      .from(enforcementActions)
      .where(eq(enforcementActions.restaurantId, id))
      .orderBy(asc(enforcementActions.actionOn), asc(enforcementActions.id));
    const hist = history.map((h) => ({ actionOn: h.actionOn, type: h.type as ActionType, authority: h.authority }));
    const d = today();
    const ck = (await loadCheckups(db, [id], d)).get(id)!;
    const [owner] = await db.select().from(restaurantOwners).where(eq(restaurantOwners.restaurantId, id)).limit(1);
    const badges = await badgesFor(db, [id], d);

    let compliance = null;
    if (owner) {
      const sc = score(ck.checkup);
      const paused = isOpenAction(r.currentStatus);
      const evs = ck.checkup.evidence;
      compliance = {
        paused,
        /* never shown publicly while an official action is open */
        score: paused ? null : sc.overall,
        rating: paused ? null : grade(sc.overall),
        requirementsMet: sc.done,
        requirementsTotal: sc.total,
        categories: sc.categories,
        criticalOpen: sc.critical.map((q) => q.text),
        freshness: freshness(ck.checkup),
        evidenceCounts: {
          total: evs.length,
          photos: evs.filter((e) => e.kind === "photo").length,
          videos: evs.filter((e) => e.kind === "video").length,
          documents: evs.filter((e) => e.kind === "document").length,
        },
        lastUpdated: evs.map((e) => e.capturedOn).sort().at(-1) ?? null,
        verifiedOn: owner.level === "platform" ? owner.verifiedOn : null,
      };
    }

    const photos = deps.config.PUBLIC_GALLERY
      ? await db
          .select()
          .from(evidence)
          /* photos showing people stay out until faces can be blurred */
          .where(
            and(
              eq(evidence.restaurantId, id),
              eq(evidence.status, "verified"),
              eq(evidence.kind, "photo"),
              eq(evidence.containsPeople, false),
              /* diners see recent photos only: older ones drop out of the gallery after GALLERY_DAYS */
              gte(evidence.capturedOn, new Date(Date.parse(d + "T00:00:00Z") - GALLERY_DAYS * 86_400_000).toISOString().slice(0, 10)),
            ),
          )
          .orderBy(desc(evidence.capturedOn))
          .limit(60)
      : [];
    const gallery = await Promise.all(
      photos.map(async (p) => ({
        id: p.id,
        requirementId: p.requirementId,
        capturedOn: p.capturedOn,
        source: p.source,
        facesBlurred: p.facesBlurred > 0,
        url: await deps.storage.signedGetUrl(p.storageKey, 3600),
      })),
    );

    /* accepted, shared reports from the last 2 weeks, in full; the bill stays private */
    const since = new Date(deps.now().getTime() - PUBLIC_REPORT_DAYS * 86_400_000);
    const published = await db
      .select({ rep: reports, resp: restaurantResponses })
      .from(reports)
      .leftJoin(restaurantResponses, eq(restaurantResponses.reportId, reports.id))
      .where(and(eq(reports.restaurantId, id), eq(reports.status, "accepted"), eq(reports.share, true), gte(reports.createdAt, since)))
      .orderBy(desc(reports.createdAt))
      .limit(50);
    const kinds = published.length
      ? await db
          .select()
          .from(reportEvidence)
          .where(inArray(reportEvidence.reportId, published.map((p) => p.rep.id)))
      : [];
    const sign = (key: string) => deps.storage.signedGetUrl(key, 3600);
    const [waiting] = await db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.restaurantId, id), eq(reports.status, "pending"), eq(reports.share, true)));

    return {
      ...card(r, badges.get(id), summaryLine(hist, r.lastVerifiedOn)),
      history: [...history].reverse().map((h) => ({ actionOn: h.actionOn, type: h.type, summary: h.summary, authority: h.authority, sourceUrl: h.sourceUrl })),
      compliance,
      gallery,
      reports: await Promise.all(
        published.map(async ({ rep, resp }) => ({
          id: rep.id,
          ref: reportRef(rep.id),
          date: isoDateIST(rep.createdAt),
          createdAt: rep.createdAt.toISOString(),
          publicUntil: publicUntil(rep.createdAt).toISOString(),
          category: rep.category,
          text: rep.text,
          hasPhoto: kinds.some((k) => k.reportId === rep.id && k.kind === "photo"),
          hasBill: kinds.some((k) => k.reportId === rep.id && k.kind === "bill"),
          /* food photos go public with the report, under the same switch as the kitchen gallery */
          photos: deps.config.PUBLIC_GALLERY ? await Promise.all(kinds.filter((k) => k.reportId === rep.id && k.kind === "photo").map((k) => sign(k.storageKey))) : [],
          /* the restaurant's action, once PlateWatch has checked the proof */
          response:
            resp && resp.status === "approved"
              ? {
                  text: resp.text,
                  date: isoDateIST(resp.createdAt),
                  hasEvidence: !!resp.storageKey,
                  proof: resp.storageKey && (resp.proofKind === "document" || deps.config.PUBLIC_GALLERY) ? { kind: resp.proofKind ?? "photo", url: await sign(resp.storageKey) } : null,
                }
              : null,
        })),
      ),
      reportsAwaitingModeration: waiting?.n ?? 0,
    };
  });

  app.post("/api/restaurants/:id/corrections", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(Correction, req.body);
    const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!r) throw notFound("No restaurant with that ID.");
    const [row] = await db.insert(correctionRequests).values({ restaurantId: id, role: body.role, message: body.message, userId: req.user?.id ?? null }).returning();
    return reply.status(201).send({ reference: `PW-C${row!.id}` });
  });

  app.post("/api/place-suggestions", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = parse(Suggestion, req.body);
    await db.insert(placeSuggestions).values({ ...body, userId: req.user?.id ?? null });
    return reply.status(201).send({ ok: true });
  });
}
