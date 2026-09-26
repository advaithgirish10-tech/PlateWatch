import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evidence, reportEvidence } from "../src/db/schema.js";
import { dhash } from "../src/storage/faces.js";
import { sanitizeImage } from "../src/storage/files.js";
import { samplePdf, setupApp, texturedJpeg, type T } from "./helpers.js";

let t: T;
let owner: string, admin: string, diner: string, diner2: string;
const HARBOUR = { id: 1, lic: "11526998000101" };

beforeAll(async () => {
  t = await setupApp({ gallery: true });
  owner = await t.login("9899900001", { owner: true });
  admin = await t.login("9899900002", { admin: true });
  diner = await t.login("9899900003");
  diner2 = await t.login("9899900004");
  await t.db.insert((await import("../src/db/schema.js")).restaurantOwners).values({ restaurantId: HARBOUR.id, userId: (await t.db.select().from((await import("../src/db/schema.js")).users).where(eq((await import("../src/db/schema.js")).users.phone, "+919899900001")))[0]!.id });
});
afterAll(async () => t.close());

const evidenceUpload = async (requirementId: string, body: Buffer, type = "image/jpeg") => {
  const { uploadId } = await t.upload(owner, "evidence", body, type, type === "application/pdf" ? "doc.pdf" : "photo.jpg");
  return t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/evidence`, { cookie: owner, body: { requirementId, uploadId } });
};

describe("faces are blurred before a photo is stored", () => {
  it("pixelates each face the detector finds", async () => {
    const original = await texturedJpeg(1, 200);
    t.faces.boxes = [{ x: 60, y: 60, width: 60, height: 60 }];
    const r = await evidenceUpload("k1", original);
    t.faces.boxes = [];
    expect(r.statusCode).toBe(201);
    const [row] = await t.db.select().from(evidence).where(eq(evidence.id, r.json().id));
    expect(row!.facesBlurred).toBe(1);
    /* against the same photo re-saved without blurring: the face area changed a lot, a far corner didn't */
    const stored = t.storage.files.get(row!.storageKey)!.body;
    const unblurred = await sanitizeImage(original, "image/jpeg");
    const diff = async (left: number, top: number) => {
      const a = await sharp(unblurred).extract({ left, top, width: 30, height: 30 }).raw().toBuffer();
      const b = await sharp(stored).extract({ left, top, width: 30, height: 30 }).raw().toBuffer();
      return a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;
    };
    expect(await diff(75, 75)).toBeGreaterThan(20);
    expect(await diff(0, 0)).toBeLessThan(6);
  });

  it("refuses the photo when faces can't be checked, and takes it once they can", async () => {
    const { uploadId } = await t.upload(diner, "report", await texturedJpeg(2), "image/jpeg");
    const send = () => t.call("POST", "/api/reports", { cookie: diner, body: { restaurantId: 5, category: "Hygiene", share: true, evidence: [{ uploadId }] } });
    t.faces.fail = true;
    const r = await send();
    t.faces.fail = false;
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toBe("FACE_CHECK_FAILED");
    expect((await send()).statusCode).toBe(201);
  });
});

describe("reused photos and PDFs are flagged", () => {
  it("fingerprints survive re-encoding; different photos differ; blank photos aren't compared", async () => {
    const a = await texturedJpeg(3, 200);
    const smaller = await sharp(a).resize(120).jpeg({ quality: 50 }).toBuffer();
    const bits = (x: bigint, y: bigint) => [...BigInt.asUintN(64, x ^ y).toString(2)].filter((c) => c === "1").length;
    expect(bits((await dhash(a))!, (await dhash(smaller))!)).toBeLessThanOrEqual(6);
    expect(bits((await dhash(a))!, (await dhash(await texturedJpeg(4, 200)))!)).toBeGreaterThan(6);
    expect(await dhash(await sharp({ create: { width: 50, height: 50, channels: 3, background: "#222" } }).jpeg().toBuffer())).toBeNull();
  });

  it("flags last cycle's kitchen photo sent again, and shows the reviewer the earlier one", async () => {
    const photo = await texturedJpeg(5, 200);
    const first = await evidenceUpload("k3", photo);
    const again = await evidenceUpload("k3", await sharp(photo).jpeg({ quality: 70 }).toBuffer());
    const other = await evidenceUpload("k4", await texturedJpeg(6, 200));
    const flags = await t.db.select({ id: evidence.id, flagged: evidence.flagged }).from(evidence);
    expect(flags.find((f) => f.id === first.json().id)!.flagged).toBe(false);
    expect(flags.find((f) => f.id === again.json().id)!.flagged).toBe(true);
    expect(flags.find((f) => f.id === other.json().id)!.flagged).toBe(false);
    const item = (await t.call("GET", `/api/admin/evidence/${again.json().id}`, { cookie: admin })).json();
    expect(item.reuse).toMatchObject({ source: "evidence", label: "checkup evidence (k3)", restaurant: "Harbour Lane Café", url: expect.stringMatching(/^\/api\/dev\/storage\//) });
  });

  it("flags an identical PDF", async () => {
    await evidenceUpload("p1", samplePdf(), "application/pdf");
    const r = await evidenceUpload("p2", samplePdf(), "application/pdf");
    const item = (await t.call("GET", `/api/admin/evidence/${r.json().id}`, { cookie: admin })).json();
    expect(item).toMatchObject({ flagged: true, reuse: { exact: true } });
  });

  it("shows a moderator when a report photo was used before", async () => {
    const food = await texturedJpeg(8, 200);
    const one = await t.upload(diner2, "report", food, "image/jpeg");
    const r = await t.call("POST", "/api/reports", { cookie: diner2, body: { restaurantId: 6, category: "Hygiene", share: true, evidence: [{ uploadId: one.uploadId }] } });
    t.advance(86_400_000);
    const two = await t.upload(diner2, "report", food, "image/jpeg");
    const r2 = await t.call("POST", "/api/reports", { cookie: diner2, body: { restaurantId: 7, category: "Hygiene", share: true, evidence: [{ uploadId: two.uploadId }] } });
    const queue = (await t.call("GET", "/api/admin/reports", { cookie: admin })).json().items;
    expect(queue.find((x: { id: number }) => x.id === r.json().id).files[0].reuse).toBeNull();
    expect(queue.find((x: { id: number }) => x.id === r2.json().id).files[0].reuse).toMatchObject({ source: "report", label: `a diner's report (PW-${4100 + r.json().id})` });
    const rows = await t.db.select().from(reportEvidence);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
