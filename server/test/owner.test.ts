import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evidence } from "../src/db/schema.js";
import { REQUIREMENTS } from "../src/db/sample-data.js";
import { jpegWithGps, samplePdf, setupApp, type T } from "./helpers.js";

let t: T;
let owner: string, stranger: string, admin: string;
const HARBOUR = { id: 1, lic: "11526998000101" };
const GREEN_LEAF = { id: 3, lic: "11525017000418" };

beforeAll(async () => {
  t = await setupApp({ gallery: true });
  owner = await t.login("9811100001", { owner: true });
  stranger = await t.login("9811100002", { owner: true });
  admin = await t.login("9811100003", { admin: true });
});
afterAll(async () => t.close());

const claim = (cookie: string, restaurantId: number, licenceNumber: string) => t.call("POST", "/api/owner/claims", { cookie, body: { restaurantId, licenceNumber } });

/* pest control (p…) and documentation (d…) take a PDF; everything else a photo */
async function submitEvidence(cookie: string, rid: number, requirementId: string) {
  const pdf = /^[pd]/.test(requirementId);
  const { uploadId } = pdf
    ? await t.upload(cookie, "evidence", samplePdf(), "application/pdf", `${requirementId}.pdf`)
    : await t.upload(cookie, "evidence", await jpegWithGps(), "image/jpeg", `${requirementId}.jpg`);
  return t.call("POST", `/api/owner/restaurants/${rid}/evidence`, { cookie, body: { requirementId, uploadId } });
}

describe("claiming", () => {
  it("needs the right licence number", async () => {
    const r = await claim(owner, HARBOUR.id, "11526998000999");
    expect(r.statusCode).toBe(400);
  });

  it("claims an unclaimed restaurant", async () => {
    const r = await claim(owner, HARBOUR.id, HARBOUR.lic);
    expect(r.statusCode).toBe(201);
    expect((await t.call("GET", "/api/me", { cookie: owner })).json().user.ownedRestaurantIds).toEqual([HARBOUR.id]);
  });

  it("won't let a different number take over a claimed restaurant", async () => {
    const r = await claim(stranger, HARBOUR.id, HARBOUR.lic);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("ALREADY_CLAIMED");
  });

  it("lets the owner sign back in to it", async () => {
    expect((await claim(owner, HARBOUR.id, HARBOUR.lic)).json()).toMatchObject({ existing: true });
  });

  it("keeps other people out of the dashboard", async () => {
    expect((await t.call("GET", `/api/owner/restaurants/${HARBOUR.id}/checkup`, { cookie: stranger })).statusCode).toBe(403);
    expect((await t.call("PUT", `/api/owner/restaurants/${HARBOUR.id}/answers/k1`, { cookie: stranger, body: { answer: "yes" } })).statusCode).toBe(403);
  });
});

describe("uploads", () => {
  it("strips EXIF, including GPS, from photos", async () => {
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const r = await submitEvidence(owner, HARBOUR.id, "k1");
    expect(r.statusCode).toBe(201);
    const [row] = await t.db.select().from(evidence).where(eq(evidence.id, r.json().id));
    const stored = t.storage.files.get(row!.storageKey)!.body;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(row!.status).toBe("submitted");
  });

  it("rejects a file that only claims to be a photo", async () => {
    const { uploadId } = await t.upload(owner, "evidence", Buffer.from("<script>alert(1)</script>"), "image/jpeg", "evil.jpg");
    const r = await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/evidence`, { cookie: owner, body: { requirementId: "k2", uploadId } });
    expect(r.statusCode).toBe(400);
    expect(r.json().details.code).toBe("UPLOAD_BAD_TYPE");
  });

  it("takes only PDFs for pest control and documentation, and only photos elsewhere", async () => {
    const attach = async (requirementId: string, body: Buffer, type: string) => {
      const { uploadId } = await t.upload(owner, "evidence", body, type);
      return t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/evidence`, { cookie: owner, body: { requirementId, uploadId } });
    };
    const photoForPest = await attach("p2", await jpegWithGps(), "image/jpeg");
    expect(photoForPest.statusCode).toBe(400);
    expect(photoForPest.json().message).toMatch(/need a PDF/);
    expect((await attach("d1", await jpegWithGps(), "image/jpeg")).statusCode).toBe(400);
    const pdfForKitchen = await attach("k4", samplePdf(), "application/pdf");
    expect(pdfForKitchen.json().message).toMatch(/needs a photo/);
    expect((await attach("k4", Buffer.from("00000018667479706d703432", "hex"), "video/mp4")).statusCode).toBe(400);
  });

  it("refuses unsupported types and oversize files before any upload", async () => {
    expect((await t.upload(owner, "evidence", Buffer.from("x"), "image/heic")).res.statusCode).toBe(400);
    const big = await t.call("POST", "/api/uploads", { cookie: owner, body: { purpose: "evidence", contentType: "image/jpeg", size: 11 * 1024 * 1024, filename: "big.jpg" } });
    expect(big.statusCode).toBe(400);
  });

  it("can't reuse an upload, or use someone else's", async () => {
    const { uploadId } = await t.upload(owner, "evidence", await jpegWithGps(), "image/jpeg");
    const first = await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/evidence`, { cookie: owner, body: { requirementId: "k3", uploadId } });
    expect(first.statusCode).toBe(201);
    const again = await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/evidence`, { cookie: owner, body: { requirementId: "k3", uploadId } });
    expect(again.statusCode).toBe(409);

    await claim(stranger, GREEN_LEAF.id, GREEN_LEAF.lic);
    const theirs = await t.upload(stranger, "evidence", await jpegWithGps(), "image/jpeg");
    const stolen = await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/evidence`, { cookie: owner, body: { requirementId: "k4", uploadId: theirs.uploadId } });
    expect(stolen.statusCode).toBe(409);
  });

  it("rejects a PUT whose size doesn't match the signed size", async () => {
    const r = await t.call("POST", "/api/uploads", { cookie: owner, body: { purpose: "evidence", contentType: "image/jpeg", size: 10, filename: "a.jpg" } });
    const { url, headers } = r.json();
    const put = await t.app.inject({ method: "PUT", url, payload: Buffer.alloc(2000), headers: { ...headers, origin: "http://localhost:5173" } });
    expect(put.statusCode).toBe(403);
  });
});

describe("checkup, score and verification", () => {
  it("scores only 'yes' answers backed by current evidence", async () => {
    const r = await t.call("GET", `/api/owner/restaurants/${HARBOUR.id}/checkup`, { cookie: owner });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    /* k1 and k3 have evidence and were answered yes by uploading */
    expect(d.score.done).toBe(2);
    expect(d.score.total).toBe(27);
    expect(d.score.overall).toBe(Math.round((2 + 1) / REQUIREMENTS.reduce((s, q) => s + q[3], 0) * 100));
    expect(d.score.pausedPublicly).toBe(true);
    expect(d.nextBest[0].requirementId).toBe("k2");
    expect(d.evidence.find((e: { requirementId: string }) => e.requirementId === "k1").url).toMatch(/^\/api\/dev\/storage\//);
  });

  it("hides the score publicly while an official action is open", async () => {
    const p = (await t.call("GET", `/api/restaurants/${HARBOUR.id}`)).json();
    expect(p.status).toBe("sus");
    expect(p.compliance).toMatchObject({ paused: true, score: null, rating: null, requirementsMet: 2 });
    expect(p.badge.level).toBe("claimed");
  });

  it("won't take a verification request with unanswered items", async () => {
    const r = await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/verification-request`, { cookie: owner });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("UNANSWERED");
  });

  it("goes all the way to PlateWatch verified", async () => {
    for (const [id] of REQUIREMENTS) {
      if (id === "k1" || id === "k3") continue;
      expect((await submitEvidence(owner, HARBOUR.id, id)).statusCode).toBe(201);
    }
    expect((await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/verification-request`, { cookie: owner })).statusCode).toBe(204);
    expect((await t.call("POST", `/api/owner/restaurants/${HARBOUR.id}/verification-request`, { cookie: owner })).statusCode).toBe(409);

    const queue = (await t.call("GET", "/api/admin/verification-requests", { cookie: admin })).json().items;
    expect(queue).toEqual([expect.objectContaining({ restaurantId: HARBOUR.id, owner: "+91 98111 00001" })]);

    /* evidence still waiting blocks approval */
    const blocked = await t.call("POST", `/api/admin/restaurants/${HARBOUR.id}/verification`, { cookie: admin, body: { decision: "approve" } });
    expect(blocked.json().error).toBe("EVIDENCE_PENDING");

    const pending = (await t.call("GET", "/api/admin/evidence?filter=pending&limit=100", { cookie: admin })).json();
    const mine = pending.items.filter((e: { restaurant: { id: number } }) => e.restaurant.id === HARBOUR.id);
    expect(mine.length).toBeGreaterThanOrEqual(27);
    for (const e of mine) expect((await t.call("POST", `/api/admin/evidence/${e.id}/decision`, { cookie: admin, body: { decision: "verified" } })).statusCode).toBe(204);

    expect((await t.call("POST", `/api/admin/restaurants/${HARBOUR.id}/verification`, { cookie: admin, body: { decision: "approve" } })).statusCode).toBe(204);
    const p = (await t.call("GET", `/api/restaurants/${HARBOUR.id}`)).json();
    expect(p.badge).toEqual({ level: "verified" });
    /* the badge never overrides the official record: the score stays hidden */
    expect(p.compliance.score).toBeNull();
    expect(p.gallery.length).toBeGreaterThan(0);
  });

  it("pauses the badge when new evidence waits for review, and when evidence expires", async () => {
    await submitEvidence(owner, HARBOUR.id, "k1");
    let p = (await t.call("GET", `/api/restaurants/${HARBOUR.id}`)).json();
    expect(p.badge).toEqual({ level: "claimed", paused: ["new evidence waiting for review"] });
    const pending = (await t.call("GET", "/api/admin/evidence?filter=pending", { cookie: admin })).json().items;
    for (const e of pending.filter((x: { restaurant: { id: number } }) => x.restaurant.id === HARBOUR.id)) {
      await t.call("POST", `/api/admin/evidence/${e.id}/decision`, { cookie: admin, body: { decision: "verified" } });
    }
    expect((await t.call("GET", `/api/restaurants/${HARBOUR.id}`)).json().badge).toEqual({ level: "verified" });
    /* 31 days later the 30-day categories have expired */
    t.advance(31 * 86_400_000);
    p = (await t.call("GET", `/api/restaurants/${HARBOUR.id}`)).json();
    expect(p.badge.level).toBe("claimed");
    expect(p.badge.paused[0]).toMatch(/requirements without current approved evidence/);
    t.advance(-31 * 86_400_000);
  });

  it("gives reviewers the file, earlier submissions and the restaurant's score", async () => {
    await submitEvidence(owner, HARBOUR.id, "k1");
    const [latest] = (await t.call("GET", "/api/admin/evidence?filter=pending", { cookie: admin })).json().items;
    const d = (await t.call("GET", `/api/admin/evidence/${latest.id}`, { cookie: admin })).json();
    expect(d).toMatchObject({ kind: "photo", status: "submitted", expiryDays: 14, restaurantScore: { total: 27 }, submittedBy: "+91 98111 00001" });
    expect(d.history.length).toBeGreaterThanOrEqual(2);
    expect(d.url).toMatch(/^\/api\/dev\/storage\//);
    expect((await t.call("GET", `/api/admin/evidence/${latest.id}`, { cookie: owner })).statusCode).toBe(403);
    expect((await t.call("PATCH", `/api/admin/evidence/${latest.id}`, { cookie: admin, body: { reviewNote: "Corner is dark", flagged: true } })).statusCode).toBe(204);
    expect((await t.call("GET", `/api/admin/evidence/${latest.id}`, { cookie: admin })).json()).toMatchObject({ reviewNote: "Corner is dark", flagged: true });
    const ev = (await t.call("GET", `/api/owner/restaurants/${HARBOUR.id}/checkup`, { cookie: owner })).json().evidence;
    expect(ev.find((e: { id: string }) => e.id === latest.id)).toMatchObject({ status: "submitted", expired: false });
  });
});
