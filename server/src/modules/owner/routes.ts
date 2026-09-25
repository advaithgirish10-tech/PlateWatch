import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../../auth/sessions.js";
import { evidence, reportEvidence, reports, responses, restaurantOwners, restaurantResponses, restaurants } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { daysBetween, isoDateIST } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { cleanText, idParam, parse } from "../../lib/validate.js";
import { reportRef } from "../reports/dto.js";
import { isOpenAction } from "../restaurants/service.js";
import { consumeUpload } from "../uploads/service.js";
import { loadCheckups } from "./checkup-data.js";
import { badge, freshness, grade, score } from "./score.js";

const Claim = z.object({ restaurantId: z.number().int().positive(), licenceNumber: z.string().max(20) });
const AnswerBody = z.object({ answer: z.enum(["yes", "no", "na"]) });
const EvidenceBody = z.object({ requirementId: z.string().max(10), uploadId: z.uuid(), note: cleanText(500).optional() });
const ResponseBody = z.object({ text: cleanText(1000).pipe(z.string().min(5)), uploadId: z.uuid().optional() });
const ReqParams = z.object({ id: z.coerce.number().int().positive(), reqId: z.string().max(10) });
const ReportParams = z.object({ id: z.coerce.number().int().positive(), reportId: z.coerce.number().int().positive() });

export async function ownerRoutes(app: FastifyInstance) {
  const { deps } = app;
  const { db } = deps;
  const today = () => isoDateIST(deps.now());

  /* the owner of this restaurant, or an admin */
  async function ownerOf(req: FastifyRequest, restaurantId: number) {
    const me = requireUser(req);
    const [o] = await db.select().from(restaurantOwners).where(eq(restaurantOwners.restaurantId, restaurantId)).limit(1);
    if (!o) throw notFound("This restaurant hasn't been claimed.");
    if (o.userId !== me.id && me.role !== "admin") throw forbidden("You don't manage this restaurant.");
    return { me, owner: o };
  }

  /* claim with the licence number; the signed-in, OTP-verified number becomes the owner's */
  app.post("/api/owner/claims", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Claim, req.body);
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, body.restaurantId)).limit(1);
    if (!r) throw notFound("No restaurant with that ID.");
    if (body.licenceNumber.replace(/\D/g, "") !== r.licenceNumber) throw badRequest("That licence number doesn't match our records for this restaurant.", { fields: { licenceNumber: "mismatch" } });
    const [existing] = await db.select().from(restaurantOwners).where(eq(restaurantOwners.restaurantId, r.id)).limit(1);
    if (existing) {
      if (existing.userId === me.id) return reply.status(200).send({ restaurantId: r.id, level: existing.level, existing: true });
      throw conflict("ALREADY_CLAIMED", "This restaurant is already claimed by another number. If you're the owner, contact support to transfer it.");
    }
    await db.transaction(async (tx) => {
      await tx.insert(restaurantOwners).values({ restaurantId: r.id, userId: me.id, level: "self" });
      await audit(tx, { actorId: me.id, action: "owner.claim", entityType: "restaurant", entityId: r.id });
    });
    return reply.status(201).send({ restaurantId: r.id, level: "self", existing: false });
  });

  app.get("/api/owner/restaurants", async (req) => {
    const me = requireUser(req);
    const rows = await db
      .select({ r: restaurants, o: restaurantOwners })
      .from(restaurantOwners)
      .innerJoin(restaurants, eq(restaurants.id, restaurantOwners.restaurantId))
      .where(eq(restaurantOwners.userId, me.id));
    const cks = await loadCheckups(db, rows.map((x) => x.r.id), today());
    return {
      items: rows.map(({ r, o }) => {
        const ck = cks.get(r.id)!;
        const sc = score(ck.checkup);
        return { id: r.id, name: r.name, area: r.area, city: r.city, level: o.level, score: sc.overall, requirementsMet: sc.done, requirementsTotal: sc.total, badge: badge(o.level, ck.checkup) };
      }),
    };
  });

  /* everything the dashboard's checkup and overview tabs need */
  app.get("/api/owner/restaurants/:id/checkup", async (req) => {
    const { id } = parse(idParam, req.params);
    const { owner } = await ownerOf(req, id);
    const d = today();
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
    const ck = (await loadCheckups(db, [id], d)).get(id)!;
    const sc = score(ck.checkup);
    const all = await db.select().from(evidence).where(eq(evidence.restaurantId, id)).orderBy(desc(evidence.createdAt));
    const withUrls = await Promise.all(
      all.map(async (e) => ({
        id: e.id,
        requirementId: e.requirementId,
        kind: e.kind,
        name: e.originalName,
        capturedOn: e.capturedOn,
        status: e.status,
        /* past its category's validity: no longer counts, whatever its review status */
        expired: e.status !== "rejected" && daysBetween(e.capturedOn, d) > ck.checkup.cats.get(ck.checkup.reqs.find((q) => q.id === e.requirementId)!.categoryKey)!.expiryDays,
        note: e.note,
        flagged: e.flagged,
        url: await deps.storage.signedGetUrl(e.storageKey, 3600),
      })),
    );
    const nextBest = [...sc.missing]
      .sort((a, b) => +b.requirement.critical - +a.requirement.critical || b.requirement.weight - a.requirement.weight || +(b.why === "Evidence expired") - +(a.why === "Evidence expired"))
      .slice(0, 3)
      .map((m) => ({ requirementId: m.requirement.id, why: m.why }));
    const expiringSoon = ck.checkup.reqs
      .filter((q) => ck.checkup.answers.get(q.id) === "yes")
      .map((q) => {
        const exp = ck.checkup.cats.get(q.categoryKey)!.expiryDays;
        const cur = ck.checkup.evidence.filter((e) => e.requirementId === q.id && daysBetween(e.capturedOn, d) <= exp);
        if (!cur.length) return null;
        return { requirementId: q.id, daysLeft: exp - Math.min(...cur.map((e) => daysBetween(e.capturedOn, d))) };
      })
      .filter((x): x is { requirementId: string; daysLeft: number } => !!x && x.daysLeft <= 7)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 3);
    return {
      restaurant: { id: r!.id, name: r!.name, area: r!.area, city: r!.city },
      /* approved photos are shown to diners only once PUBLIC_GALLERY is on */
      publicGallery: deps.config.PUBLIC_GALLERY,
      level: owner.level,
      verifiedOn: owner.verifiedOn,
      adminNote: owner.adminNote,
      badge: badge(owner.level, ck.checkup),
      score: { ...sc, rating: grade(sc.overall), pausedPublicly: isOpenAction(r!.currentStatus), critical: sc.critical.map((q) => q.id), missing: sc.missing.map((m) => ({ requirementId: m.requirement.id, why: m.why })) },
      freshness: freshness(ck.checkup),
      nextBest,
      expiringSoon,
      categories: [...ck.checkup.cats.values()],
      requirements: ck.checkup.reqs.map((q) => ({ ...q, answer: ck.checkup.answers.get(q.id) ?? null })),
      evidence: withUrls,
    };
  });

  app.put("/api/owner/restaurants/:id/answers/:reqId", async (req, reply) => {
    const { id, reqId } = parse(ReqParams, req.params);
    const { me } = await ownerOf(req, id);
    const { answer } = parse(AnswerBody, req.body);
    const { reqs } = (await loadCheckups(db, [id], today())).get(id)!.checkup;
    if (!reqs.some((q) => q.id === reqId)) throw notFound("No such requirement.");
    await db
      .insert(responses)
      .values({ restaurantId: id, requirementId: reqId, answer, updatedBy: me.id })
      .onConflictDoUpdate({ target: [responses.restaurantId, responses.requirementId], set: { answer, updatedBy: me.id, updatedAt: deps.now() } });
    return reply.status(204).send();
  });

  app.post("/api/owner/restaurants/:id/evidence", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { me } = await ownerOf(req, id);
    const body = parse(EvidenceBody, req.body);
    const { reqs } = (await loadCheckups(db, [id], today())).get(id)!.checkup;
    if (!reqs.some((q) => q.id === body.requirementId)) throw notFound("No such requirement.");
    const f = await consumeUpload(deps, { uploadId: body.uploadId, userId: me.id, purpose: "evidence" });
    const row = await db.transaction(async (tx) => {
      const [ev] = await tx
        .insert(evidence)
        .values({
          restaurantId: id,
          requirementId: body.requirementId,
          kind: f.kind,
          storageKey: f.storageKey,
          originalName: f.originalName,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          capturedOn: today(),
          note: body.note || null,
          submittedBy: me.id,
        })
        .returning();
      /* uploading evidence for an unanswered requirement answers it "yes" */
      await tx.insert(responses).values({ restaurantId: id, requirementId: body.requirementId, answer: "yes", updatedBy: me.id }).onConflictDoNothing();
      await audit(tx, { actorId: me.id, action: "evidence.submit", entityType: "evidence", entityId: ev!.id, data: { restaurantId: id, requirementId: body.requirementId } });
      return ev!;
    });
    return reply.status(201).send({ id: row.id, status: row.status });
  });

  app.post("/api/owner/restaurants/:id/verification-request", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { me, owner } = await ownerOf(req, id);
    if (owner.level !== "self") throw conflict("NOT_ALLOWED", owner.level === "pending" ? "Verification is already requested." : "This restaurant is already PlateWatch verified.");
    const sc = score((await loadCheckups(db, [id], today())).get(id)!.checkup);
    if (sc.unanswered) throw conflict("UNANSWERED", `Answer all requirements first (${sc.unanswered} left).`);
    await db.transaction(async (tx) => {
      await tx.update(restaurantOwners).set({ level: "pending", requestedOn: today(), adminNote: null, updatedAt: deps.now() }).where(eq(restaurantOwners.restaurantId, id));
      await audit(tx, { actorId: me.id, action: "verification.request", entityType: "restaurant", entityId: id });
    });
    return reply.status(204).send();
  });

  /* reports the restaurant can see: accepted by a moderator and shared by the reporter */
  app.get("/api/owner/restaurants/:id/reports", async (req) => {
    const { id } = parse(idParam, req.params);
    await ownerOf(req, id);
    const rows = await db
      .select({ rep: reports, resp: restaurantResponses })
      .from(reports)
      .leftJoin(restaurantResponses, eq(restaurantResponses.reportId, reports.id))
      .where(and(eq(reports.restaurantId, id), eq(reports.status, "accepted"), eq(reports.share, true)))
      .orderBy(desc(reports.createdAt));
    const kinds = rows.length
      ? await db.select({ reportId: reportEvidence.reportId, kind: reportEvidence.kind }).from(reportEvidence).where(and(inArray(reportEvidence.reportId, rows.map((x) => x.rep.id)), ne(reportEvidence.kind, "note")))
      : [];
    return {
      items: rows.map(({ rep, resp }) => ({
        id: rep.id,
        ref: reportRef(rep.id),
        date: isoDateIST(rep.createdAt),
        category: rep.category,
        text: rep.text,
        evidence: kinds.filter((k) => k.reportId === rep.id).map((k) => k.kind),
        flagged: rep.flaggedByOwner,
        response: resp ? { text: resp.text, date: isoDateIST(resp.createdAt), hasEvidence: !!resp.storageKey } : null,
      })),
    };
  });

  async function visibleReport(restaurantId: number, reportId: number) {
    const [rep] = await db
      .select()
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.restaurantId, restaurantId), eq(reports.status, "accepted"), eq(reports.share, true)))
      .limit(1);
    if (!rep) throw notFound("No such report.");
    return rep;
  }

  app.post("/api/owner/restaurants/:id/reports/:reportId/response", async (req, reply) => {
    const { id, reportId } = parse(ReportParams, req.params);
    const { me } = await ownerOf(req, id);
    const body = parse(ResponseBody, req.body);
    await visibleReport(id, reportId);
    const [already] = await db.select({ id: restaurantResponses.reportId }).from(restaurantResponses).where(eq(restaurantResponses.reportId, reportId)).limit(1);
    if (already) throw conflict("ALREADY_RESPONDED", "You've already responded to this report.");
    const f = body.uploadId ? await consumeUpload(deps, { uploadId: body.uploadId, userId: me.id, purpose: "response" }) : null;
    await db.transaction(async (tx) => {
      await tx.insert(restaurantResponses).values({ reportId, text: body.text, storageKey: f?.storageKey ?? null, originalName: f?.originalName ?? null, respondedBy: me.id });
      await audit(tx, { actorId: me.id, action: "report.respond", entityType: "report", entityId: reportId });
    });
    return reply.status(201).send({ ok: true });
  });

  app.post("/api/owner/restaurants/:id/reports/:reportId/flag", async (req, reply) => {
    const { id, reportId } = parse(ReportParams, req.params);
    const { me } = await ownerOf(req, id);
    await visibleReport(id, reportId);
    await db.transaction(async (tx) => {
      await tx.update(reports).set({ flaggedByOwner: true }).where(eq(reports.id, reportId));
      await audit(tx, { actorId: me.id, action: "report.flag", entityType: "report", entityId: reportId });
    });
    return reply.status(204).send();
  });
}
