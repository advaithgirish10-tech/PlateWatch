import { and, asc, count, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/sessions.js";
import {
  auditLog,
  evidence,
  reportEvidence,
  reports,
  requirementCategories,
  requirements,
  restaurantOwners,
  restaurantResponses,
  restaurants,
  users,
} from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { addDays, daysBetween, isoDateIST } from "../../lib/dates.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { displayPhone } from "../../lib/phone.js";
import { cleanText, idParam, parse, uuidParam } from "../../lib/validate.js";
import { loadCatalog, loadCheckups } from "../owner/checkup-data.js";
import { score } from "../owner/score.js";
import { reportRef } from "../reports/dto.js";
import { addEnforcementAction, likeEscape } from "../restaurants/service.js";

const isoDate = z.iso.date();
const VerificationDecision = z.object({ decision: z.enum(["approve", "more", "reject"]) });
const EvidenceQuery = z.object({
  filter: z.enum(["all", "pending", "flagged", "recent"]).default("all"),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["new", "old", "priority"]).default("new"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const EvidenceDecision = z.object({ decision: z.enum(["verified", "rejected", "more"]), reviewNote: cleanText(1000).optional() });
const EvidencePatch = z.object({ flagged: z.boolean().optional(), reviewNote: cleanText(1000).optional(), containsPeople: z.boolean().optional() });
const ReportDecision = z
  .object({ decision: z.enum(["accept", "reject", "more", "coordinated", "keep"]), reason: cleanText(200).optional() })
  .refine((b) => b.decision !== "reject" || !!b.reason, { message: "Give a reason for rejecting.", path: ["reason"] });
const Action = z.object({
  actionOn: isoDate,
  type: z.enum(["sus", "rev", "imp", "ok"]),
  summary: cleanText(500).pipe(z.string().min(5)),
  authority: cleanText(120).optional(),
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
});
const NewRestaurant = z.object({
  name: cleanText(120).pipe(z.string().min(2)),
  area: cleanText(120).pipe(z.string().min(2)),
  city: cleanText(80).pipe(z.string().min(2)),
  category: cleanText(60).pipe(z.string().min(2)),
  licenceNumber: z.string().regex(/^\d{14}$/, "FSSAI licence numbers are 14 digits"),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  lastVerifiedOn: isoDate,
});
const RequirementPatch = z.object({ weight: z.number().int().min(1).max(5).optional(), critical: z.boolean().optional() });
const CategoryPatch = z.object({ expiryDays: z.number().int().min(1).max(730) });
const AuditQuery = z.object({ entityType: z.string().max(40).optional(), entityId: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

const NOTES = {
  more: "Reviewer requested more evidence before verification. Check items marked 'More needed'.",
  reject: "Verification request was not approved. Review your evidence and try again.",
};

export async function adminRoutes(app: FastifyInstance) {
  const { deps } = app;
  const { db } = deps;
  const today = () => isoDateIST(deps.now());

  const evidenceRows = () =>
    db
      .select({ e: evidence, r: restaurants, q: requirements, cat: requirementCategories, phone: users.phone, level: restaurantOwners.level })
      .from(evidence)
      .innerJoin(restaurants, eq(restaurants.id, evidence.restaurantId))
      .innerJoin(requirements, eq(requirements.id, evidence.requirementId))
      .innerJoin(requirementCategories, eq(requirementCategories.key, requirements.categoryKey))
      .leftJoin(restaurantOwners, eq(restaurantOwners.restaurantId, evidence.restaurantId))
      .leftJoin(users, eq(users.id, evidence.submittedBy));
  type EvidenceRow = Awaited<ReturnType<ReturnType<typeof evidenceRows>["where"]>>[number];
  /* short-lived signed links, for photos, PDFs and videos alike */
  const evidenceItem = async ({ e, r, q, cat, phone, level }: EvidenceRow) => ({
    id: e.id,
    restaurant: { id: r.id, name: r.name, area: r.area, city: r.city },
    requirement: { id: q.id, text: q.text, weight: q.weight, critical: q.critical, category: cat.name },
    kind: e.kind,
    name: e.originalName,
    status: e.status,
    flagged: e.flagged,
    containsPeople: e.containsPeople,
    capturedOn: e.capturedOn,
    validUntilDays: cat.expiryDays - daysBetween(e.capturedOn, today()),
    note: e.note,
    reviewNote: e.reviewNote,
    submittedBy: phone ? displayPhone(phone) : null,
    ownerLevel: level,
    url: await deps.storage.signedGetUrl(e.storageKey, 900),
  });

  /* every route in this plugin is admin-only */
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin/")) requireAdmin(req);
  });

  app.get("/api/admin/summary", async () => {
    const [ev] = await db.select({ n: count() }).from(evidence).where(inArray(evidence.status, ["submitted", "more"]));
    const [vr] = await db.select({ n: count() }).from(restaurantOwners).where(eq(restaurantOwners.level, "pending"));
    const [rp] = await db
      .select({ n: count() })
      .from(reports)
      .where(or(eq(reports.status, "pending"), and(eq(reports.flaggedByOwner, true), sql`${reports.status} <> 'rejected'`)));
    /* evidence that stops counting within 7 days */
    const [ex] = await db
      .select({ n: count() })
      .from(evidence)
      .innerJoin(requirements, eq(requirements.id, evidence.requirementId))
      .innerJoin(requirementCategories, eq(requirementCategories.key, requirements.categoryKey))
      .where(and(ne(evidence.status, "rejected"), sql`(${evidence.capturedOn} + ${requirementCategories.expiryDays}) - ${today()}::date between 0 and 7`));
    return { pendingEvidence: ev?.n ?? 0, verificationRequests: vr?.n ?? 0, reportsToModerate: rp?.n ?? 0, expiringSoon: ex?.n ?? 0 };
  });

  /* the checkup as staff edit it: categories with their expiry, requirements with weight and critical flag */
  app.get("/api/admin/catalog", async () => {
    const { cats, reqs } = await loadCatalog(db);
    return { categories: [...cats.values()], requirements: reqs };
  });

  /* ---------- verification requests ---------- */

  app.get("/api/admin/verification-requests", async () => {
    const rows = await db
      .select({ o: restaurantOwners, r: restaurants, phone: users.phone })
      .from(restaurantOwners)
      .innerJoin(restaurants, eq(restaurants.id, restaurantOwners.restaurantId))
      .innerJoin(users, eq(users.id, restaurantOwners.userId))
      .where(eq(restaurantOwners.level, "pending"))
      .orderBy(asc(restaurantOwners.requestedOn));
    const cks = await loadCheckups(db, rows.map((x) => x.r.id), today());
    return {
      items: rows.map(({ o, r, phone }) => {
        const ck = cks.get(r.id)!;
        const sc = score(ck.checkup);
        return {
          restaurantId: r.id,
          name: r.name,
          area: r.area,
          city: r.city,
          category: r.category,
          owner: displayPhone(phone),
          requestedOn: o.requestedOn,
          score: sc.overall,
          requirementsMet: sc.done,
          requirementsTotal: sc.total,
          evidenceItems: ck.checkup.evidence.length,
          pendingEvidence: ck.checkup.evidence.filter((e) => e.status === "submitted" || e.status === "more").length,
          criticalOpen: sc.critical.map((q) => q.text),
        };
      }),
    };
  });

  app.post("/api/admin/restaurants/:id/verification", async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const { decision } = parse(VerificationDecision, req.body);
    const [o] = await db.select().from(restaurantOwners).where(eq(restaurantOwners.restaurantId, id)).limit(1);
    if (!o || o.level !== "pending") throw notFound("No pending verification request for this restaurant.");
    if (decision === "approve") {
      const [p] = await db.select({ n: count() }).from(evidence).where(and(eq(evidence.restaurantId, id), inArray(evidence.status, ["submitted", "more"])));
      if ((p?.n ?? 0) > 0) throw conflict("EVIDENCE_PENDING", `Review the ${p!.n} pending evidence item${p!.n === 1 ? "" : "s"} first.`);
      /* verified means every applicable requirement is met; anything less would show as "paused" straight away */
      const sc = score((await loadCheckups(db, [id], today())).get(id)!.checkup);
      if (sc.done < sc.total) throw conflict("REQUIREMENTS_OPEN", `${sc.total - sc.done} requirement${sc.total - sc.done === 1 ? " is" : "s are"} still without current evidence. Ask for more instead.`);
    }
    await db.transaction(async (tx) => {
      await tx
        .update(restaurantOwners)
        .set(
          decision === "approve"
            ? { level: "platform", verifiedOn: today(), adminNote: null, updatedAt: deps.now() }
            : { level: "self", adminNote: NOTES[decision], updatedAt: deps.now() },
        )
        .where(eq(restaurantOwners.restaurantId, id));
      await audit(tx, { actorId: admin.id, action: `verification.${decision}`, entityType: "restaurant", entityId: id });
    });
    return reply.status(204).send();
  });

  /* ---------- evidence review ---------- */

  app.get("/api/admin/evidence", async (req) => {
    const q = parse(EvidenceQuery, req.query);
    const where: SQL[] = [inArray(evidence.status, ["submitted", "more"])];
    if (q.filter === "pending") where.push(eq(evidence.status, "submitted"));
    if (q.filter === "flagged") where.push(eq(evidence.flagged, true));
    if (q.filter === "recent") where.push(sql`${evidence.capturedOn} >= ${today()}::date - 3`);
    if (q.q) {
      const like = "%" + likeEscape(q.q.toLowerCase()) + "%";
      where.push(sql`(lower(${evidence.originalName}) like ${like} or ${restaurants.searchText} like ${like} or lower(${requirements.text}) like ${like})`);
    }
    const order =
      q.sort === "old"
        ? [asc(evidence.createdAt)]
        : q.sort === "priority"
          ? [sql`(case when ${requirements.critical} then 100 else 0 end + ${requirements.weight} * 10 + case when ${evidence.flagged} then 5 else 0 end + case when ${evidence.status} = 'more' then 3 else 0 end) desc`, asc(evidence.createdAt)]
          : [desc(evidence.createdAt)];
    const rows = await evidenceRows().where(and(...where)).orderBy(...order).limit(q.limit).offset(q.offset);
    const [total] = await db
      .select({ n: count() })
      .from(evidence)
      .innerJoin(restaurants, eq(restaurants.id, evidence.restaurantId))
      .innerJoin(requirements, eq(requirements.id, evidence.requirementId))
      .where(and(...where));
    return { total: total?.n ?? 0, items: await Promise.all(rows.map(evidenceItem)) };
  });

  /* one item for the review panel: the file, earlier submissions for the same requirement, the restaurant's score */
  app.get("/api/admin/evidence/:id", async (req) => {
    const { id } = parse(uuidParam, req.params);
    const [row] = await evidenceRows().where(eq(evidence.id, id)).limit(1);
    if (!row) throw notFound("No such evidence.");
    const history = await db
      .select({ id: evidence.id, name: evidence.originalName, capturedOn: evidence.capturedOn, status: evidence.status, flagged: evidence.flagged })
      .from(evidence)
      .where(and(eq(evidence.restaurantId, row.r.id), eq(evidence.requirementId, row.q.id), ne(evidence.id, id)))
      .orderBy(desc(evidence.capturedOn));
    const sc = score((await loadCheckups(db, [row.r.id], today())).get(row.r.id)!.checkup);
    return {
      ...(await evidenceItem(row)),
      validUntil: addDays(row.e.capturedOn, row.cat.expiryDays),
      expiryDays: row.cat.expiryDays,
      history,
      restaurantScore: { overall: sc.overall, done: sc.done, total: sc.total },
    };
  });

  app.post("/api/admin/evidence/:id/decision", async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(EvidenceDecision, req.body);
    const done = await db.transaction(async (tx) => {
      const [e] = await tx
        .update(evidence)
        .set({ status: body.decision, reviewedBy: admin.id, reviewedAt: deps.now(), ...(body.reviewNote !== undefined ? { reviewNote: body.reviewNote } : {}) })
        .where(eq(evidence.id, id))
        .returning({ id: evidence.id, restaurantId: evidence.restaurantId });
      if (!e) return null;
      await audit(tx, { actorId: admin.id, action: `evidence.${body.decision}`, entityType: "evidence", entityId: id, data: { restaurantId: e.restaurantId } });
      return e;
    });
    if (!done) throw notFound("No such evidence.");
    return reply.status(204).send();
  });

  app.patch("/api/admin/evidence/:id", async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(EvidencePatch, req.body);
    if (!Object.keys(body).length) throw badRequest("Nothing to change.");
    const [e] = await db.update(evidence).set(body).where(eq(evidence.id, id)).returning({ id: evidence.id });
    if (!e) throw notFound("No such evidence.");
    if (body.flagged !== undefined || body.containsPeople !== undefined) {
      await audit(db, { actorId: admin.id, action: "evidence.update", entityType: "evidence", entityId: id, data: { flagged: body.flagged, containsPeople: body.containsPeople } });
    }
    return reply.status(204).send();
  });

  /* ---------- community report moderation ---------- */

  app.get("/api/admin/reports", async () => {
    const rows = await db
      .select({ rep: reports, r: restaurants, verifiedAt: users.phoneVerifiedAt, response: restaurantResponses.text })
      .from(reports)
      .leftJoin(restaurants, eq(restaurants.id, reports.restaurantId))
      .leftJoin(users, eq(users.id, reports.userId))
      .leftJoin(restaurantResponses, eq(restaurantResponses.reportId, reports.id))
      .where(or(eq(reports.status, "pending"), and(eq(reports.flaggedByOwner, true), sql`${reports.status} <> 'rejected'`)))
      .orderBy(asc(reports.createdAt))
      .limit(200);
    const ev = rows.length ? await db.select().from(reportEvidence).where(inArray(reportEvidence.reportId, rows.map((x) => x.rep.id))) : [];
    const links = new Map(await Promise.all(ev.map(async (e) => [e.id, await deps.storage.signedGetUrl(e.storageKey, 900)] as const)));
    const now = deps.now();
    return {
      items: rows.map(({ rep, r, verifiedAt, response }) => {
        const kinds = ev.filter((e) => e.reportId === rep.id).map((e) => e.kind);
        const hasEvidence = kinds.some((k) => k !== "note");
        /* moderators see how long the number has been verified, never the number */
        const numberAgeDays = verifiedAt ? Math.floor((now.getTime() - verifiedAt.getTime()) / 86_400_000) : null;
        return {
          id: rep.id,
          ref: reportRef(rep.id),
          place: r ? { id: r.id, name: r.name, area: r.area, city: r.city } : { id: null, name: rep.unlistedName, area: rep.unlistedArea, city: null },
          category: rep.category,
          text: rep.text,
          channel: rep.channel,
          receivedOn: isoDateIST(rep.createdAt),
          status: rep.status,
          askMore: rep.askMore,
          share: rep.share,
          flaggedByOwner: rep.flaggedByOwner,
          evidence: kinds,
          files: ev.filter((e) => e.reportId === rep.id).map((e) => ({ kind: e.kind, name: e.originalName, url: links.get(e.id)! })),
          response,
          numberAgeDays,
          countsTowardEscalation: !rep.share
            ? "No · kept private"
            : !hasEvidence
              ? "No · no photo, video or bill"
              : numberAgeDays == null
                ? "No · no verified number"
                : !r
                  ? "No · outlet not listed yet"
                  : `Yes · weight ${numberAgeDays < 7 ? "0.5 (new number)" : "1.0"}${rep.status === "accepted" ? "" : " once accepted"}`,
        };
      }),
    };
  });

  app.post("/api/admin/reports/:id/decision", async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const body = parse(ReportDecision, req.body);
    const [rep] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!rep) throw notFound("No such report.");
    const now = deps.now();
    const moderated = { moderatedBy: admin.id, moderatedAt: now };
    const set =
      body.decision === "accept"
        ? { status: "accepted" as const, askMore: false, notifiedAt: rep.share && rep.restaurantId ? now : null, ...moderated }
        : body.decision === "reject"
          ? { status: "rejected" as const, askMore: false, rejectReason: body.reason!, flaggedByOwner: false, ...moderated }
          : body.decision === "coordinated"
            ? { status: "rejected" as const, coordinated: true, askMore: false, rejectReason: "part of a coordinated set of reports", ...moderated }
            : body.decision === "more"
              ? { askMore: true }
              : { flaggedByOwner: false, ...moderated };
    if (body.decision === "more" && (rep.status !== "pending" || !rep.userId)) throw conflict("NOT_ALLOWED", "Only pending reports from a verified number can be sent back.");
    await db.transaction(async (tx) => {
      await tx.update(reports).set(set).where(eq(reports.id, id));
      await audit(tx, { actorId: admin.id, action: `report.${body.decision}`, entityType: "report", entityId: id, data: body.reason ? { reason: body.reason } : undefined });
    });
    return reply.status(204).send();
  });

  /* ---------- the official record ---------- */

  app.post("/api/admin/restaurants", async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parse(NewRestaurant, req.body);
    const [dupe] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.licenceNumber, body.licenceNumber)).limit(1);
    if (dupe) throw conflict("DUPLICATE_LICENCE", `Licence ${body.licenceNumber} is already listed (restaurant ${dupe.id}).`);
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(restaurants)
        .values({
          name: body.name,
          area: body.area,
          city: body.city,
          category: body.category,
          licenceNumber: body.licenceNumber,
          location: body.location ? { x: body.location.lng, y: body.location.lat } : null,
          lastVerifiedOn: body.lastVerifiedOn,
        })
        .returning({ id: restaurants.id });
      await audit(tx, { actorId: admin.id, action: "restaurant.create", entityType: "restaurant", entityId: r!.id });
      return r!;
    });
    return reply.status(201).send({ id: row.id });
  });

  app.post("/api/admin/restaurants/:id/actions", async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const body = parse(Action, req.body);
    const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!r) throw notFound("No restaurant with that ID.");
    const row = await db.transaction((tx) => addEnforcementAction(tx, { restaurantId: id, ...body, actorId: admin.id }));
    return reply.status(201).send({ id: row.id });
  });

  /* ---------- scoring rules ---------- */

  app.put("/api/admin/requirements/:id", async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(z.object({ id: z.string().max(10) }), req.params);
    const body = parse(RequirementPatch, req.body);
    if (!Object.keys(body).length) throw badRequest("Nothing to change.");
    const [r] = await db.update(requirements).set(body).where(eq(requirements.id, id)).returning({ id: requirements.id });
    if (!r) throw notFound("No such requirement.");
    await audit(db, { actorId: admin.id, action: "requirement.update", entityType: "requirement", entityId: id, data: body });
    return reply.status(204).send();
  });

  app.put("/api/admin/categories/:key", async (req, reply) => {
    const admin = requireAdmin(req);
    const { key } = parse(z.object({ key: z.string().max(20) }), req.params);
    const body = parse(CategoryPatch, req.body);
    const [c] = await db.update(requirementCategories).set(body).where(eq(requirementCategories.key, key)).returning({ key: requirementCategories.key });
    if (!c) throw notFound("No such category.");
    await audit(db, { actorId: admin.id, action: "category.update", entityType: "category", entityId: key, data: body });
    return reply.status(204).send();
  });

  app.get("/api/admin/audit", async (req) => {
    const q = parse(AuditQuery, req.query);
    const where: SQL[] = [];
    if (q.entityType) where.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) where.push(eq(auditLog.entityId, q.entityId));
    const rows = await db.select().from(auditLog).where(where.length ? and(...where) : undefined).orderBy(desc(auditLog.id)).limit(q.limit);
    return { items: rows };
  });
}
