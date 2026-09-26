import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { evidence, restaurants } from "../src/db/schema.js";
import { jpegWithGps, setupApp, type T } from "./helpers.js";

let t: T;
let diner: string, owner: string, admin: string;
beforeAll(async () => {
  t = await setupApp({ gallery: true, reportsPerDay: 1 });
  diner = await t.login("9844400001");
  owner = await t.login("9844400002", { owner: true });
  admin = await t.login("9844400003", { admin: true });
});
afterAll(async () => t.close());

describe("reports", () => {
  it("defaults to one report per person per day", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x@y/z", OTP_PEPPER: "0123456789abcdef" }).REPORTS_PER_DAY).toBe(1);
  });

  it("takes one report a day, then refuses until tomorrow", async () => {
    const send = (restaurantId: number) => t.call("POST", "/api/reports", { cookie: diner, body: { restaurantId, category: "Hygiene", share: true } });
    expect((await send(2)).statusCode).toBe(201);
    const second = await send(3);
    expect(second.statusCode).toBe(429);
    expect(second.json().message).toBe("You can send one report a day. Try again tomorrow.");
    t.advance(24 * 3_600_000);
    expect((await send(3)).statusCode).toBe(201);
  });

  it("won't let an owner report their own restaurant", async () => {
    await t.claimApproved(owner, admin, 13, "11526027001589");
    const r = await t.call("POST", "/api/reports", { cookie: owner, body: { restaurantId: 13, category: "Hygiene", share: true } });
    expect(r.statusCode).toBe(403);
  });
});

describe("restaurants imported without a licence", () => {
  let id: number;
  beforeAll(async () => {
    const [r] = await t.db.insert(restaurants).values({ name: "Imported Chai Stall", area: "Fort", city: "Mumbai", category: "Café", lastVerifiedOn: "2026-09-25", source: "osm", osmId: "node/77" }).returning();
    id = r!.id;
  });

  it("are claimed with the owner's licence number, which then waits for a staff check", async () => {
    const other = await t.login("9844400004", { owner: true });
    expect((await t.requestClaim(other, id, "123")).statusCode).toBe(400);
    expect((await t.requestClaim(other, id, "11526027001589")).json().error).toBe("LICENCE_IN_USE");
    const c = await t.requestClaim(other, id, "11526099999999");
    expect(c.statusCode).toBe(202);
    /* the number goes on the profile only once staff approve the claim */
    expect((await t.call("GET", `/api/restaurants/${id}`)).json().licenceNumber).toBeNull();
    await t.call("POST", `/api/admin/claims/${c.json().claimId}/decision`, { cookie: admin, body: { decision: "approve" } });
    const p = (await t.call("GET", `/api/restaurants/${id}`)).json();
    expect(p).toMatchObject({ licenceNumber: "11526099999999", licenceStatus: null, source: "osm" });
    const queue = (await t.call("GET", "/api/admin/licence-checks", { cookie: admin })).json().items;
    /* claimed restaurants that were never checked come first */
    expect(queue.slice(0, 2).map((x: { name: string }) => x.name)).toEqual(["Bandra Bao Co.", "Imported Chai Stall"]);
    expect(queue.find((x: { id: number }) => x.id === id)).toMatchObject({ claimed: true, licenceStatus: null });
  });

  it("staff record what FoSCoS showed, and the map can filter by it", async () => {
    expect((await t.call("POST", `/api/admin/restaurants/${id}/licence-check`, { cookie: diner, body: { status: "active" } })).statusCode).toBe(403);
    expect((await t.call("POST", `/api/admin/restaurants/${id}/licence-check`, { cookie: admin, body: { status: "active" } })).statusCode).toBe(204);
    const p = (await t.call("GET", `/api/restaurants/${id}`)).json();
    expect(p.licenceStatus).toBe("active");
    expect(p.licenceCheckedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await t.call("GET", "/api/admin/licence-checks", { cookie: admin })).json().items.some((x: { id: number }) => x.id === id)).toBe(false);
    const active = (await t.call("GET", "/api/restaurants?licence=active")).json().items;
    expect(active.map((x: { id: number }) => x.id)).toEqual([id]);
    expect((await t.call("GET", "/api/restaurants?licence=unchecked&limit=500")).json().items.length).toBe(34);
  });

  it("staff can add a missing licence number", async () => {
    const [r] = await t.db.insert(restaurants).values({ name: "No Licence Yet", area: "Fort", city: "Mumbai", category: "Café", lastVerifiedOn: "2026-09-25", source: "osm", osmId: "node/78" }).returning();
    expect((await t.call("POST", `/api/admin/restaurants/${r!.id}/licence-check`, { cookie: admin, body: { status: "active" } })).json().error).toBe("NO_LICENCE");
    expect((await t.call("PATCH", `/api/admin/restaurants/${r!.id}`, { cookie: admin, body: { licenceNumber: "11526011111111" } })).statusCode).toBe(204);
    expect((await t.call("PATCH", `/api/admin/restaurants/${r!.id}`, { cookie: admin, body: { licenceNumber: "11526099999999" } })).json().error).toBe("DUPLICATE_LICENCE");
  });
});

describe("kitchen gallery", () => {
  it("shows approved kitchen photos, but never ones marked as showing people", async () => {
    const add = async (req: string) => {
      const { uploadId } = await t.upload(owner, "evidence", await jpegWithGps(), "image/jpeg", `${req}.jpg`);
      return (await t.call("POST", "/api/owner/restaurants/13/evidence", { cookie: owner, body: { requirementId: req, uploadId } })).json().id as string;
    };
    const clean = await add("k1"), people = await add("h2"), pending = await add("k2");
    for (const id of [clean, people]) await t.call("POST", `/api/admin/evidence/${id}/decision`, { cookie: admin, body: { decision: "verified" } });
    await t.call("PATCH", `/api/admin/evidence/${people}`, { cookie: admin, body: { containsPeople: true } });
    const g = (await t.call("GET", "/api/restaurants/13")).json().gallery;
    expect(g.map((x: { id: string }) => x.id)).toEqual([clean]);
    expect((await t.db.select().from(evidence).where(eq(evidence.id, pending)))[0]!.status).toBe("submitted");
  });
});
