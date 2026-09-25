import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../../auth/sessions.js";
import type { Queryable } from "../../db/client.js";
import { reportEvidence, reports, restaurants } from "../../db/schema.js";
import { isoDateIST, startOfDayIST } from "../../lib/dates.js";
import { conflict, notFound, tooMany } from "../../lib/errors.js";
import { cleanText, idParam, parse } from "../../lib/validate.js";
import type { Deps } from "../../types.js";
import { consumeUpload } from "../uploads/service.js";
import { REPORT_CATEGORIES, STAGES, reportRef, stageOf } from "./dto.js";

const Body = z
  .object({
    restaurantId: z.number().int().positive().optional(),
    unlisted: z.object({ name: cleanText(120).pipe(z.string().min(2)), area: cleanText(120).pipe(z.string().min(2)) }).optional(),
    category: z.enum(REPORT_CATEGORIES),
    text: cleanText(500).optional(),
    share: z.boolean(),
    evidence: z
      .array(z.object({ uploadId: z.uuid(), kind: z.enum(["bill", "note"]).optional() }))
      .max(10)
      .default([]),
  })
  .refine((b) => !!b.restaurantId !== !!b.unlisted, { message: "Choose a listed place or name an unlisted one.", path: ["restaurantId"] });

const MoreEvidence = z.object({
  evidence: z
    .array(z.object({ uploadId: z.uuid(), kind: z.enum(["bill", "note"]).optional() }))
    .min(1)
    .max(5),
});

const PER_OUTLET_DAYS = 7;

/* the guardrails, checked again inside the write transaction */
async function checkGuardrails(tx: Queryable, deps: Deps, userId: string, place: { restaurantId?: number; unlistedName?: string }) {
  const now = deps.now();
  const [today] = await tx.select({ n: count() }).from(reports).where(and(eq(reports.userId, userId), gte(reports.createdAt, startOfDayIST(now))));
  if ((today?.n ?? 0) >= deps.config.REPORTS_PER_DAY) throw tooMany("DAILY_LIMIT", "You've reached today's limit. Try again tomorrow.");
  const since = new Date(now.getTime() - PER_OUTLET_DAYS * 86_400_000);
  const same = place.restaurantId
    ? eq(reports.restaurantId, place.restaurantId)
    : and(isNull(reports.restaurantId), sql`lower(${reports.unlistedName}) = lower(${place.unlistedName!})`);
  const [prev] = await tx.select({ id: reports.id }).from(reports).where(and(eq(reports.userId, userId), same, gte(reports.createdAt, since))).limit(1);
  if (prev) throw conflict("ALREADY_REPORTED", `You've already reported this place this week. We'll update you on that report (${reportRef(prev.id)}).`);
}

export async function reportRoutes(app: FastifyInstance) {
  const { deps } = app;
  const { db } = deps;

  app.post("/api/reports", async (req, reply) => {
    const user = requireUser(req);
    const body = parse(Body, req.body);
    if (body.restaurantId) {
      const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, body.restaurantId)).limit(1);
      if (!r) throw notFound("No restaurant with that ID.");
    }
    const place = { restaurantId: body.restaurantId, unlistedName: body.unlisted?.name };
    /* fail fast before touching uploads, then again under a per-user lock */
    await checkGuardrails(db, deps, user.id, place);
    const files: { storageKey: string; originalName: string; kind: "photo" | "video" | "bill" | "note" }[] = [];
    for (const e of body.evidence) {
      const f = await consumeUpload(deps, { uploadId: e.uploadId, userId: user.id, purpose: "report" });
      files.push({ storageKey: f.storageKey, originalName: f.originalName, kind: e.kind ?? (f.kind === "document" ? "bill" : f.kind) });
    }
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"report:" + user.id}))`);
      await checkGuardrails(tx, deps, user.id, place);
      const [rep] = await tx
        .insert(reports)
        .values({
          restaurantId: body.restaurantId ?? null,
          unlistedName: body.unlisted?.name ?? null,
          unlistedArea: body.unlisted?.area ?? null,
          userId: user.id,
          category: body.category,
          text: body.text || `${body.category} reported.`,
          share: body.share,
          channel: "web",
          createdAt: deps.now(),
        })
        .returning();
      if (files.length) {
        await tx.insert(reportEvidence).values(files.map((f) => ({ reportId: rep!.id, kind: f.kind, storageKey: f.storageKey, originalName: f.originalName })));
      }
      return rep!;
    });
    const hasEvidence = files.some((f) => f.kind === "photo" || f.kind === "video" || f.kind === "bill");
    return reply.status(201).send({
      id: created.id,
      ref: reportRef(created.id),
      status: created.status,
      /* no photo, video or bill: saved, but never sent to the regulator */
      canEscalate: created.share && hasEvidence,
    });
  });

  /* a moderator asked for more: the reporter adds a photo, video or bill to their pending report */
  app.post("/api/reports/:id/evidence", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(MoreEvidence, req.body);
    const [rep] = await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, user.id))).limit(1);
    if (!rep) throw notFound("No such report.");
    if (rep.status !== "pending" || !rep.askMore) throw conflict("NOT_REQUESTED", "This report isn't waiting for more evidence.");
    const files: { storageKey: string; originalName: string; kind: "photo" | "video" | "bill" | "note" }[] = [];
    for (const e of body.evidence) {
      const f = await consumeUpload(deps, { uploadId: e.uploadId, userId: user.id, purpose: "report" });
      files.push({ storageKey: f.storageKey, originalName: f.originalName, kind: e.kind ?? (f.kind === "document" ? "bill" : f.kind) });
    }
    await db.transaction(async (tx) => {
      await tx.insert(reportEvidence).values(files.map((f) => ({ reportId: id, ...f })));
      await tx.update(reports).set({ askMore: false }).where(eq(reports.id, id));
    });
    return reply.status(201).send({ ok: true });
  });

  /* the reporter's own reports and where each one is */
  app.get("/api/me/reports", async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({ rep: reports, name: restaurants.name })
      .from(reports)
      .leftJoin(restaurants, eq(restaurants.id, reports.restaurantId))
      .where(eq(reports.userId, user.id))
      .orderBy(desc(reports.createdAt))
      .limit(100);
    const ev = rows.length
      ? await db.select({ reportId: reportEvidence.reportId, kind: reportEvidence.kind }).from(reportEvidence).where(inArray(reportEvidence.reportId, rows.map((r) => r.rep.id)))
      : [];
    return {
      items: rows.map(({ rep, name }) => {
        const stage = stageOf(rep);
        return {
          id: rep.id,
          ref: reportRef(rep.id),
          place: name ?? `${rep.unlistedName} (not listed)`,
          category: rep.category,
          date: isoDateIST(rep.createdAt),
          evidence: ev.filter((e) => e.reportId === rep.id).map((e) => e.kind),
          share: rep.share,
          stage,
          stages: rep.share ? STAGES : STAGES.slice(0, 2),
          sentToRegulatorOn: rep.sentToRegulatorOn,
          officialActionOn: rep.officialActionOn,
          rejectReason: stage < 0 ? rep.rejectReason : null,
          askMore: rep.askMore,
        };
      }),
    };
  });
}

