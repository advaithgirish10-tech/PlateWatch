import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reportEvidence } from "../src/db/schema.js";
import { jpegWithGps, setupApp, type T } from "./helpers.js";

let t: T;
beforeAll(async () => (t = await setupApp({ gallery: true })));
afterAll(async () => t.close());

describe("a published report on the profile", () => {
  it("shows the remark and the food photo to everyone, never the bill", async () => {
    const diner = await t.login("9888800001");
    const admin = await t.login("9888800002", { admin: true });
    const bill = await t.upload(diner, "report", await jpegWithGps(), "image/jpeg", "bill.jpg");
    const food = await t.upload(diner, "report", await jpegWithGps(), "image/jpeg", "food.jpg");
    const r = await t.call("POST", "/api/reports", {
      cookie: diner,
      body: { restaurantId: 4, category: "Stale or spoiled food", text: "The curd was sour and fizzy.", share: true, evidence: [{ uploadId: bill.uploadId, kind: "bill" }, { uploadId: food.uploadId }] },
    });
    const id = r.json().id;
    /* not public until a moderator accepts it */
    expect((await t.call("GET", "/api/restaurants/4")).json()).toMatchObject({ reports: [], reportsAwaitingModeration: 1 });
    await t.call("POST", `/api/admin/reports/${id}/decision`, { cookie: admin, body: { decision: "accept" } });

    const profile = await t.call("GET", "/api/restaurants/4");
    const rep = profile.json().reports[0];
    expect(rep).toMatchObject({ text: "The curd was sour and fizzy.", category: "Stale or spoiled food", hasBill: true, hasPhoto: true });
    expect(rep.photos).toHaveLength(1);
    const [billRow] = await t.db.select().from(reportEvidence).where(eq(reportEvidence.kind, "bill"));
    expect(profile.body).not.toContain(billRow!.storageKey);
    expect(Date.parse(rep.publicUntil) - Date.parse(rep.createdAt)).toBe(14 * 86_400_000);
  });
});
