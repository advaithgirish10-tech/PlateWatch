import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithGps, setupApp, type T } from "./helpers.js";

let t: T;
let reporter: string, owner: string, admin: string;

beforeAll(async () => {
  t = await setupApp();
  reporter = await t.login("9822200001");
  owner = await t.login("9822200002");
  admin = await t.login("9822200003", { admin: true });
  await t.call("POST", "/api/owner/claims", { cookie: owner, body: { restaurantId: 13, licenceNumber: "11526027001589" } });
});
afterAll(async () => t.close());

const report = (cookie: string, body: Record<string, unknown>) => t.call("POST", "/api/reports", { cookie, body: { category: "Pests", share: true, ...body } });

describe("reporting", () => {
  it("files a report with a photo and returns a receipt", async () => {
    const { uploadId } = await t.upload(reporter, "report", await jpegWithGps(), "image/jpeg", "cockroach.jpg");
    const r = await report(reporter, { restaurantId: 13, text: "Cockroach near the counter", evidence: [{ uploadId }] });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ ref: `PW-${4100 + r.json().id}`, status: "pending", canEscalate: true });
  });

  it("allows one report per place per week from a number", async () => {
    const r = await report(reporter, { restaurantId: 13 });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toMatch(/already reported this place this week/);
    t.advance(7 * 86_400_000 + 1000);
    expect((await report(reporter, { restaurantId: 13, text: "Again" })).statusCode).toBe(201);
  });

  it("marks a report without photo, video or bill as not escalatable", async () => {
    expect((await report(reporter, { restaurantId: 7 })).json().canEscalate).toBe(false);
  });

  it("takes unlisted places, and applies the weekly rule to them by name", async () => {
    expect((await report(reporter, { unlisted: { name: "Corner Pav Stall", area: "Sion" } })).statusCode).toBe(201);
    expect((await report(reporter, { unlisted: { name: "corner pav stall", area: "Sion" } })).statusCode).toBe(409);
    expect((await report(reporter, { restaurantId: 1, unlisted: { name: "X Y", area: "Z Z" } })).statusCode).toBe(400);
  });

  it("stops at 5 reports a day, even when they arrive at once", async () => {
    const someone = await t.login("9822200004");
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((id) => report(someone, { restaurantId: id })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
  });

  it("shows the reporter where each report is", async () => {
    const items = (await t.call("GET", "/api/me/reports", { cookie: reporter })).json().items;
    expect(items.length).toBe(4);
    expect(items[0]).toMatchObject({ stage: 0, stages: ["Awaiting moderation", "Accepted", "Restaurant notified", "Sent to FDA Maharashtra", "Official action taken"] });
  });
});

describe("moderation", () => {
  it("keeps the queue admin-only and never shows the reporter's number", async () => {
    expect((await t.call("GET", "/api/admin/reports", { cookie: reporter })).statusCode).toBe(403);
    const r = await t.call("GET", "/api/admin/reports", { cookie: admin });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("9822200001");
    const photoReport = r.json().items.find((x: { text: string }) => x.text === "Cockroach near the counter");
    /* the clock moved a week on earlier, so this number is no longer new and counts in full */
    expect(photoReport).toMatchObject({ evidence: ["photo"], numberAgeDays: 7, countsTowardEscalation: "Yes · weight 1.0 once accepted" });
  });

  it("publishes an accepted, shared report to the profile and the restaurant, who can reply once", async () => {
    const queue = (await t.call("GET", "/api/admin/reports", { cookie: admin })).json().items;
    const x = queue.find((i: { text: string }) => i.text === "Cockroach near the counter");
    expect((await t.call("POST", `/api/admin/reports/${x.id}/decision`, { cookie: admin, body: { decision: "accept" } })).statusCode).toBe(204);

    const profile = (await t.call("GET", "/api/restaurants/13")).json();
    expect(profile.reports).toEqual([expect.objectContaining({ id: x.id, hasPhoto: true, response: null })]);
    expect(JSON.stringify(profile)).not.toContain("9822200001");

    const mine = (await t.call("GET", "/api/me/reports", { cookie: reporter })).json().items.find((i: { id: number }) => i.id === x.id);
    expect(mine.stage).toBe(2);

    const ownerView = (await t.call("GET", "/api/owner/restaurants/13/reports", { cookie: owner })).json().items;
    expect(ownerView.map((i: { id: number }) => i.id)).toEqual([x.id]);
    const reply = () => t.call("POST", `/api/owner/restaurants/13/reports/${x.id}/response`, { cookie: owner, body: { text: "Pest control done on 26 Sep; certificate uploaded." } });
    expect((await reply()).statusCode).toBe(201);
    expect((await reply()).statusCode).toBe(409);
    expect((await t.call("GET", "/api/restaurants/13")).json().reports[0].response.text).toMatch(/Pest control done/);
  });

  it("needs a reason to reject, and tells the reporter why", async () => {
    const queue = (await t.call("GET", "/api/admin/reports", { cookie: admin })).json().items;
    const x = queue.find((i: { place: { id: number } }) => i.place.id === 7);
    expect((await t.call("POST", `/api/admin/reports/${x.id}/decision`, { cookie: admin, body: { decision: "reject" } })).statusCode).toBe(400);
    expect((await t.call("POST", `/api/admin/reports/${x.id}/decision`, { cookie: admin, body: { decision: "reject", reason: "Not enough detail to act on" } })).statusCode).toBe(204);
    const mine = (await t.call("GET", "/api/me/reports", { cookie: reporter })).json().items.find((i: { id: number }) => i.id === x.id);
    expect(mine).toMatchObject({ stage: -1, rejectReason: "Not enough detail to act on" });
  });

  it("hides private reports from the restaurant and the profile", async () => {
    const r = await report(owner, { restaurantId: 2, share: false });
    await t.call("POST", `/api/admin/reports/${r.json().id}/decision`, { cookie: admin, body: { decision: "accept" } });
    expect((await t.call("GET", "/api/restaurants/2")).json().reports).toEqual([]);
    expect((await t.call("GET", "/api/me/reports", { cookie: owner })).json().items[0].stages).toEqual(["Awaiting moderation", "Accepted"]);
  });

  it("lets the restaurant flag a report back to moderators, who see its reply and photos", async () => {
    const queueBefore = (await t.call("GET", "/api/admin/reports", { cookie: admin })).json().items.length;
    const published = (await t.call("GET", "/api/owner/restaurants/13/reports", { cookie: owner })).json().items[0];
    expect((await t.call("POST", `/api/owner/restaurants/13/reports/${published.id}/flag`, { cookie: owner })).statusCode).toBe(204);
    const queue = (await t.call("GET", "/api/admin/reports", { cookie: admin })).json().items;
    expect(queue.length).toBe(queueBefore + 1);
    const flagged = queue.find((i: { id: number }) => i.id === published.id);
    expect(flagged).toMatchObject({ flaggedByOwner: true, response: expect.stringMatching(/Pest control done/) });
    expect(flagged.files).toEqual([expect.objectContaining({ kind: "photo", name: "cockroach.jpg", url: expect.stringMatching(/^\/api\/dev\/storage\//) })]);
  });

  it("won't approve verification while requirements are unmet", async () => {
    for (const [q] of (await import("../src/db/sample-data.js")).REQUIREMENTS) {
      await t.call("PUT", `/api/owner/restaurants/13/answers/${q}`, { cookie: owner, body: { answer: "yes" } });
    }
    expect((await t.call("POST", "/api/owner/restaurants/13/verification-request", { cookie: owner })).statusCode).toBe(204);
    const r = await t.call("POST", "/api/admin/restaurants/13/verification", { cookie: admin, body: { decision: "approve" } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "REQUIREMENTS_OPEN", message: "27 requirements are still without current evidence. Ask for more instead." });
    expect((await t.call("POST", "/api/admin/restaurants/13/verification", { cookie: admin, body: { decision: "more" } })).statusCode).toBe(204);
  });

  it("lets the reporter add evidence only after a moderator asks for more", async () => {
    const r = await report(reporter, { restaurantId: 10, text: "Smelled off" });
    const id = r.json().id;
    const add = async () => {
      const { uploadId } = await t.upload(reporter, "report", await jpegWithGps(), "image/jpeg", "more.jpg");
      return t.call("POST", `/api/reports/${id}/evidence`, { cookie: reporter, body: { evidence: [{ uploadId }] } });
    };
    expect((await add()).statusCode).toBe(409);
    expect((await t.call("POST", `/api/admin/reports/${id}/decision`, { cookie: admin, body: { decision: "more" } })).statusCode).toBe(204);
    expect((await t.call("GET", "/api/me/reports", { cookie: reporter })).json().items.find((i: { id: number }) => i.id === id).askMore).toBe(true);
    /* nobody else can add to it */
    const { uploadId } = await t.upload(owner, "report", await jpegWithGps(), "image/jpeg");
    expect((await t.call("POST", `/api/reports/${id}/evidence`, { cookie: owner, body: { evidence: [{ uploadId }] } })).statusCode).toBe(404);
    expect((await add()).statusCode).toBe(201);
    const mine = (await t.call("GET", "/api/me/reports", { cookie: reporter })).json().items.find((i: { id: number }) => i.id === id);
    expect(mine).toMatchObject({ askMore: false, evidence: ["photo"] });
  });
});
