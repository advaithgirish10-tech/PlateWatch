import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireOwnerLogin } from "../../auth/sessions.js";
import { claimRequests, evidence, reportEvidence, reports, responses, restaurantOwners, restaurantResponses, restaurants, uploads } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { daysBetween, isoDateIST } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { cleanText, idParam, parse } from "../../lib/validate.js";
import { publicUntil, reportRef } from "../reports/dto.js";
import { isOpenAction } from "../restaurants/service.js";
import { recordFingerprint } from "../fingerprints/service.js";
import { claimRequested } from "../notifications/events.js";
import { consumeUpload } from "../uploads/service.js";
import { loadCheckups } from "./checkup-data.js";
import { badge, freshness, grade, score } from "./score.js";

const PDF_ONLY = new Set(["pest", "docs"]);
/* the licence number, and the FSSAI licence or registration certificate that shows it (a PDF or photo) */
const Claim = z.object({ restaurantId: z.number().int().positive(), licenceNumber: z.string().max(20), uploadId: z.uuid().optional() });
const AnswerBody = z.object({ answer: z.enum(["yes", "no", "na"]) });
const EvidenceBody = z.object({ requirementId: z.string().max(10), uploadId: z.uuid(), note: cleanText(500).optional() });
/* "action taken": what the restaurant did, with proof (a live photo or a PDF) */
const ResponseBody = z.object({ text: cleanText(1000).pipe(z.string().min(5, "Say what you did, in a few words.")), uploadId: z.uuid({ message: "Add proof: a photo or a PDF." }) });
const ReqParams = z.object({ id: z.coerce.number().int().positive(), reqId: z.string().max(10) });
const EvidenceParams = z.object({ id: z.coerce.number().int().positive(), evidenceId: z.uuid() });
const ReportParams = z.object({ id: z.coerce.number().int().positive(), reportId: z.coerce.number().int().positive() });

export async function ownerRoutes(app: FastifyInstance) {
  const { deps } = app;
  const { db } = deps;
  const today = () => isoDateIST(deps.now());

  /* the owner of this restaurant, or an admin */
  async function ownerOf(req: FastifyRequest, restaurantId: number) {
    const me = requireOwnerLogin(req);
    const [o] = await db.select().from(restaurantOwners).where(eq(restaurantOwners.restaurantId, restaurantId)).limit(1);
    if (!o) throw notFound("This restaurant hasn't been claimed.");
    if (o.userId !== me.id && me.role !== "admin") throw forbidden("You don't manage this restaurant.");
    return { me, owner: o };
  }

  /*
   * Claim with the licence number and the licence certificate. PlateWatch staff compare the two and approve the claim
   * (within 24 hours) before the dashboard opens: a licence number alone is printed on the profile for anyone to read.
   */
  app.post("/api/owner/claims", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const me = requireOwnerLogin(req);
    const body = parse(Claim, req.body);
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, body.restaurantId)).limit(1);
    if (!r) throw notFound("No restaurant with that ID.");
    const lic = body.licenceNumber.replace(/\D/g, "");
    if (r.licenceNumber) {
      if (lic !== r.licenceNumber) throw badRequest("That licence number doesn't match our records for this restaurant.", { fields: { licenceNumber: "mismatch" } });
    } else {
      /* no licence on record yet (imported from OpenStreetMap): the owner's number is saved, and staff check it on FoSCoS */
      if (!/^\d{14}$/.test(lic)) throw badRequest("FSSAI licence and registration numbers are 14 digits.", { fields: { licenceNumber: "invalid" } });
      const [taken] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.licenceNumber, lic)).limit(1);
      if (taken) throw conflict("LICENCE_IN_USE", "That licence number belongs to another restaurant on PlateWatch. Contact support if it's yours.");
    }
    const [existing] = await db.select().from(restaurantOwners).where(eq(restaurantOwners.restaurantId, r.id)).limit(1);
    if (existing) {
      if (existing.userId === me.id) return reply.status(200).send({ restaurantId: r.id, level: existing.level, existing: true });
      throw conflict("ALREADY_CLAIMED", "This restaurant is already claimed by another number. If you're the owner, contact support to transfer it.");
    }
    const [mine] = await db
      .select({ id: claimRequests.id })
      .from(claimRequests)
      .where(and(eq(claimRequests.restaurantId, r.id), eq(claimRequests.userId, me.id), eq(claimRequests.status, "pending")))
      .limit(1);
    if (mine) throw conflict("CLAIM_PENDING", "Your claim for this restaurant is waiting for PlateWatch to check it.");
    if (!body.uploadId) throw badRequest("Add a photo or PDF of your FSSAI licence or registration certificate.", { fields: { uploadId: "required" } });
    const f = await consumeUpload(deps, { uploadId: body.uploadId, userId: me.id, purpose: "claim" });
    const claim = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(claimRequests)
        .values({ restaurantId: r.id, userId: me.id, licenceNumber: lic, storageKey: f.storageKey, originalName: f.originalName, contentType: f.contentType, createdAt: deps.now() })
        .returning();
      /* one certificate used to claim two restaurants shows up for staff */
      await recordFingerprint(tx, { source: "claim", sourceId: c!.id, restaurantId: r.id, userId: me.id, storageKey: f.storageKey, fingerprint: f.fingerprint });
      await audit(tx, { actorId: me.id, action: "claim.request", entityType: "restaurant", entityId: r.id, data: { claimId: c!.id } });
      await claimRequested(tx, c!.id);
      return c!;
    });
    return reply.status(202).send({ claimId: claim.id, restaurantId: r.id, status: "pending" });
  });

  /* my claims and where each one is */
  app.get("/api/owner/claims", async (req) => {
    const me = requireOwnerLogin(req);
    const rows = await db
      .select({ c: claimRequests, r: restaurants })
      .from(claimRequests)
      .innerJoin(restaurants, eq(restaurants.id, claimRequests.restaurantId))
      .where(eq(claimRequests.userId, me.id))
      .orderBy(desc(claimRequests.createdAt))
      .limit(20);
    return {
      items: rows.map(({ c, r }) => ({
        id: c.id,
        restaurant: { id: r.id, name: r.name, area: r.area, city: r.city },
        status: c.status,
        reviewNote: c.reviewNote,
        sentAt: c.createdAt.toISOString(),
        reviewBy: c.status === "pending" ? new Date(c.createdAt.getTime() + 86_400_000).toISOString() : null,
      })),
    };
  });

  app.get("/api/owner/restaurants", async (req) => {
    const me = requireOwnerLogin(req);
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
        /* new uploads are reviewed within 24 hours */
        reviewBy: e.status === "submitted" ? new Date(e.createdAt.getTime() + 86_400_000).toISOString() : null,
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
    const q = reqs.find((x) => x.id === body.requirementId);
    if (!q) throw notFound("No such requirement.");
    /* pest control and documentation take documents (PDF); every other requirement takes a photo of the kitchen */
    const [u] = await db.select({ type: uploads.contentType }).from(uploads).where(and(eq(uploads.id, body.uploadId), eq(uploads.userId, me.id))).limit(1);
    if (!u) throw conflict("UPLOAD_UNAVAILABLE", "That upload can't be used. Upload the file again.");
    if (PDF_ONLY.has(q.categoryKey) ? u.type !== "application/pdf" : !u.type.startsWith("image/")) {
      throw badRequest(PDF_ONLY.has(q.categoryKey) ? "Pest control and documentation need a PDF: the contract, certificate or record." : "This question needs a photo of your kitchen, taken with the camera.", { code: "WRONG_EVIDENCE_TYPE" });
    }
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
          facesBlurred: f.facesBlurred,
          createdAt: deps.now(),
        })
        .returning();
      /* the same photo or PDF as before (last cycle's kitchen photo, another restaurant's certificate): flag it for the reviewer */
      const reused = await recordFingerprint(tx, { source: "evidence", sourceId: ev!.id, restaurantId: id, userId: me.id, storageKey: f.storageKey, fingerprint: f.fingerprint });
      if (reused) await tx.update(evidence).set({ flagged: true }).where(eq(evidence.id, ev!.id));
      /* uploading evidence for an unanswered requirement answers it "yes" */
      await tx.insert(responses).values({ restaurantId: id, requirementId: body.requirementId, answer: "yes", updatedBy: me.id }).onConflictDoNothing();
      await audit(tx, { actorId: me.id, action: "evidence.submit", entityType: "evidence", entityId: ev!.id, data: { restaurantId: id, requirementId: body.requirementId } });
      return ev!;
    });
    return reply.status(201).send({ id: row.id, status: row.status });
  });

  /* uploaded the wrong file: remove it. It leaves the review queue and the gallery, and stops counting towards the score */
  app.delete("/api/owner/restaurants/:id/evidence/:evidenceId", async (req, reply) => {
    const { id, evidenceId } = parse(EvidenceParams, req.params);
    const { me } = await ownerOf(req, id);
    const [ev] = await db.select().from(evidence).where(and(eq(evidence.id, evidenceId), eq(evidence.restaurantId, id))).limit(1);
    if (!ev) throw notFound("That file isn't on this checkup.");
    await db.transaction(async (tx) => {
      await tx.delete(evidence).where(eq(evidence.id, ev.id));
      await audit(tx, { actorId: me.id, action: "evidence.remove", entityType: "evidence", entityId: ev.id, data: { restaurantId: id, requirementId: ev.requirementId, kind: ev.kind, status: ev.status } });
    });
    await deps.storage.delete(ev.storageKey).catch((err) => req.log.warn({ err, key: ev.storageKey }, "couldn't delete a removed evidence file"));
    return reply.status(204).send();
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
    const files = rows.length
      ? await db.select().from(reportEvidence).where(and(inArray(reportEvidence.reportId, rows.map((x) => x.rep.id)), ne(reportEvidence.kind, "note")))
      : [];
    /* the restaurant sees the food photos; the bill stays with PlateWatch (it can carry the diner's name or card digits) */
    const photoUrls = new Map(await Promise.all(files.filter((f) => f.kind === "photo").map(async (f) => [f.id, await deps.storage.signedGetUrl(f.storageKey, 3600)] as const)));
    const now = deps.now();
    return {
      items: await Promise.all(
        rows.map(async ({ rep, resp }) => ({
          id: rep.id,
          ref: reportRef(rep.id),
          date: isoDateIST(rep.createdAt),
          createdAt: rep.createdAt.toISOString(),
          category: rep.category,
          text: rep.text,
          evidence: files.filter((k) => k.reportId === rep.id).map((k) => k.kind),
          photos: files.filter((f) => f.reportId === rep.id && f.kind === "photo").map((f) => photoUrls.get(f.id)!),
          /* shown on the public profile for 2 weeks from when it was made */
          publicUntil: publicUntil(rep.createdAt).toISOString(),
          public: publicUntil(rep.createdAt) > now,
          flagged: rep.flaggedByOwner,
          response: resp
            ? {
                text: resp.text,
                date: isoDateIST(resp.createdAt),
                status: resp.status,
                reviewNote: resp.reviewNote,
                reviewBy: resp.status === "pending" ? new Date(resp.createdAt.getTime() + 86_400_000).toISOString() : null,
                proof: resp.storageKey ? { kind: resp.proofKind, name: resp.originalName, url: await deps.storage.signedGetUrl(resp.storageKey, 3600) } : null,
              }
            : null,
        })),
      ),
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
    /* one resolution per report; after PlateWatch turns one down, the owner can send new proof */
    const [already] = await db.select().from(restaurantResponses).where(eq(restaurantResponses.reportId, reportId)).limit(1);
    if (already && already.status !== "rejected")
      throw conflict("ALREADY_RESPONDED", already.status === "pending" ? "Your proof is waiting for PlateWatch to check it." : "This report is already marked as resolved.");
    const [u] = await db.select({ type: uploads.contentType }).from(uploads).where(and(eq(uploads.id, body.uploadId), eq(uploads.userId, me.id))).limit(1);
    if (!u) throw conflict("UPLOAD_UNAVAILABLE", "That upload can't be used. Upload the file again.");
    if (!u.type.startsWith("image/") && u.type !== "application/pdf") throw badRequest("Proof must be a photo or a PDF.", { code: "WRONG_EVIDENCE_TYPE" });
    const f = await consumeUpload(deps, { uploadId: body.uploadId, userId: me.id, purpose: "response" });
    const row = { text: body.text, storageKey: f.storageKey, originalName: f.originalName, proofKind: f.kind === "document" ? ("document" as const) : ("photo" as const), facesBlurred: f.facesBlurred, status: "pending" as const, reviewNote: null, reviewedBy: null, reviewedAt: null, respondedBy: me.id, createdAt: deps.now() };
    await db.transaction(async (tx) => {
      await tx.insert(restaurantResponses).values({ reportId, ...row }).onConflictDoUpdate({ target: restaurantResponses.reportId, set: row });
      await recordFingerprint(tx, { source: "proof", sourceId: reportId, restaurantId: id, userId: me.id, storageKey: f.storageKey, fingerprint: f.fingerprint });
      await audit(tx, { actorId: me.id, action: "report.respond", entityType: "report", entityId: reportId, data: { proof: row.proofKind, again: !!already } });
    });
    if (already?.storageKey) await deps.storage.delete(already.storageKey).catch(() => {});
    return reply.status(201).send({ ok: true, status: "pending" });
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
