import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, evidence } from "../src/db/schema.js";
import { purgeOldEvidence } from "../src/jobs/retention.js";
import { jpegWithGps, samplePdf, setupApp, type T } from "./helpers.js";

let t: T;
let owner: string, stranger: string, admin: string;
const HARBOUR = { id: 1, lic: "11526998000101" };
const DAY = 86_400_000;

beforeAll(async () => {
  t = await setupApp({ gallery: true });
  owner = await t.login("9866600001", { owner: true });
  stranger = await t.login("9866600002", { owner: true });
  admin = await t.login("9866600003", { admin: true });
  await t.claimApproved(owner, admin, HARBOUR.id, HARBOUR.lic);
});
afterAll(async () => t.close());

async function submit(requirementId: string) {
  const pdf = /^[pd]/.test(requirementId);
  const { uploadId } = pdf
    ? await t.upload(owner, "evidence", samplePdf(), "application/pdf", `${requirementId}.pdf`)
    : await t.upload(owner, "evidence", await jpegWithGps(), "image/jpeg", `${requirementId}.jpg`);
  const r = await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/evidence`, { cookie: owner, body: { requirementId, uploadId } });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}
const checkup = async () => (await t.call("GET", `/api/owner/restaurants/${HARBOUR.id}/checkup`, { cookie: owner })).json();
const profile = async () => (await t.call("GET", `/api/restaurants/${HARBOUR.id}`)).json();

describe("how often evidence is needed", () => {
  it("kitchen, storage and cleaning every 2 weeks; personal weekly; operations monthly; pest control 6 months", async () => {
    const days = Object.fromEntries((await checkup()).categories.map((c: { key: string; expiryDays: number }) => [c.key, c.expiryDays]));
    expect(days).toEqual({ kitchen: 14, storage: 14, clean: 14, personal: 7, ops: 30, pest: 180, docs: 365 });
  });

  it("a kitchen photo stops counting after 14 days, and the public profile says it's overdue", async () => {
    const id = await submit("k1");
    await t.call("POST", `/api/admin/evidence/${id}/decision`, { cookie: admin, body: { decision: "verified" } });
    let c = (await profile()).compliance;
    const met = c.requirementsMet;
    let kitchen = c.freshness.find((f: { key: string }) => f.key === "kitchen");
    expect(kitchen).toMatchObject({ state: "fresh", everyDays: 14, dueOn: "2026-10-09" });

    t.advance(15 * DAY);
    c = (await profile()).compliance;
    kitchen = c.freshness.find((f: { key: string }) => f.key === "kitchen");
    expect(kitchen).toMatchObject({ state: "expired", expiredItems: 1, dueOn: "2026-10-09" });
    expect(c.requirementsMet).toBe(met - 1);
  });

  it("the public gallery shows approved photos for 30 days only", async () => {
    expect((await profile()).gallery).toHaveLength(1);
    t.advance(16 * DAY);
    expect((await profile()).gallery).toHaveLength(0);
  });
});

describe("removing a wrong upload", () => {
  /* the clock moved past the 30-day session above: sign in again */
  beforeAll(async () => {
    owner = await t.login("9866600001", { owner: true });
    stranger = await t.login("9866600002", { owner: true });
    admin = await t.login("9866600003", { admin: true });
  });

  it("the owner removes it; it leaves the checkup, the review queue and storage", async () => {
    const id = await submit("k2");
    const [row] = await t.db.select().from(evidence).where(eq(evidence.id, id));
    expect(t.storage.files.has(row!.storageKey)).toBe(true);
    expect((await checkup()).evidence.find((e: { id: string }) => e.id === id).reviewBy).toBeTruthy();

    expect((await t.call("DELETE", `/api/owner/restaurants/${HARBOUR.id}/evidence/${id}`, { cookie: stranger })).statusCode).toBe(403);
    expect((await t.call("DELETE", `/api/owner/restaurants/${HARBOUR.id}/evidence/${id}`, { cookie: owner })).statusCode).toBe(204);
    expect((await checkup()).evidence.some((e: { id: string }) => e.id === id)).toBe(false);
    const queue = (await t.call("GET", "/api/admin/evidence?filter=all", { cookie: admin })).json().items;
    expect(queue.some((e: { id: string }) => e.id === id)).toBe(false);
    expect(t.storage.files.has(row!.storageKey)).toBe(false);
    expect((await t.call("DELETE", `/api/owner/restaurants/${HARBOUR.id}/evidence/${id}`, { cookie: owner })).statusCode).toBe(404);
  });

  it("works for PDFs too", async () => {
    const id = await submit("p1");
    expect((await t.call("DELETE", `/api/owner/restaurants/${HARBOUR.id}/evidence/${id}`, { cookie: owner })).statusCode).toBe(204);
  });

  it("admins see a 24-hour review deadline on each upload", async () => {
    const id = await submit("k3");
    const item = (await t.call("GET", `/api/admin/evidence/${id}`, { cookie: admin })).json();
    expect(Date.parse(item.verifyBy) - t.clock.now.getTime()).toBe(DAY);
  });
});

describe("retention", () => {
  it("deletes photos after 4 months and PDFs after 2 years", async () => {
    const pdf = await submit("d1");
    const photo = await submit("s1");
    const deps = { ...t.app.deps, now: () => t.clock.now };
    const [photoRow] = await t.db.select().from(evidence).where(eq(evidence.id, photo));

    /* just under 4 months: kept (older photos from the tests above may go) */
    t.advance(119 * DAY);
    expect((await purgeOldEvidence(deps)).documents).toBe(0);
    expect(await t.db.select().from(evidence).where(eq(evidence.id, photo))).toHaveLength(1);
    /* 4 calendar months is up to 123 days */
    t.advance(5 * DAY);
    const r = await purgeOldEvidence(deps);
    expect(r.images).toBeGreaterThanOrEqual(1);
    expect(r.documents).toBe(0);
    expect(await t.db.select().from(evidence).where(eq(evidence.id, photo))).toHaveLength(0);
    expect(t.storage.files.has(photoRow!.storageKey)).toBe(false);
    expect(await t.db.select().from(evidence).where(eq(evidence.id, pdf))).toHaveLength(1);

    t.advance(2 * 365 * DAY);
    expect((await purgeOldEvidence(deps)).documents).toBeGreaterThanOrEqual(1);
    expect(await t.db.select().from(evidence).where(eq(evidence.id, pdf))).toHaveLength(0);
    const logged = await t.db.select().from(auditLog).where(eq(auditLog.action, "evidence.purge"));
    expect(logged.length).toBeGreaterThanOrEqual(2);
    expect(logged[0]!.actorId).toBeNull();
  });
});
