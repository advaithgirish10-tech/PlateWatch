import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "../src/db/schema.js";
import { setupApp, type T } from "./helpers.js";

let t: T;
let admin: string, user: string;

beforeAll(async () => {
  t = await setupApp();
  admin = await t.login("9833300001", { admin: true });
  user = await t.login("9833300002");
});
afterAll(async () => t.close());

const names = (r: { json: () => { items: { name: string }[] } }) => r.json().items.map((i) => i.name);

describe("public restaurant data", () => {
  it("has the homepage numbers of the prototype", async () => {
    expect((await t.call("GET", "/api/stats")).json()).toEqual({ tracked: 34, improvementNotices: 6, suspended: 5, cities: 6 });
  });

  it("searches names, areas and licence numbers, forgiving typos", async () => {
    expect(names(await t.call("GET", "/api/search?q=bao"))).toEqual(["Bandra Bao Co."]);
    expect(names(await t.call("GET", "/api/search?q=bandra%20boa"))).toContain("Bandra Bao Co.");
    expect(names(await t.call("GET", "/api/search?q=11526027001589"))).toEqual(["Bandra Bao Co."]);
    expect(names(await t.call("GET", "/api/search?q=andheri"))).toEqual(["Andheri Chaat Corner", "QuickCart Dark Store 14"]);
    expect(names(await t.call("GET", "/api/search?q=caf%C3%A9")).length).toBeGreaterThan(0);
    expect((await t.call("GET", "/api/search?q=%25%25")).json().items).toEqual([]);
    expect((await t.call("GET", "/api/search?q=a")).statusCode).toBe(400);
  });

  it("returns what's inside the map view, filtered by status and sorted newest first", async () => {
    const south = await t.call("GET", "/api/restaurants?bbox=72.80,18.90,72.86,18.95");
    expect(names(south).sort()).toEqual(["Harbour Lane Café", "Marine Drive Grill", "Sunrise Idli Corner"]);
    expect(names(await t.call("GET", "/api/restaurants?bbox=72.80,18.90,72.86,18.95&status=red"))).toEqual(["Harbour Lane Café"]);
    const all = (await t.call("GET", "/api/restaurants?status=red")).json().items;
    expect(all.map((i: { statusOn: string }) => i.statusOn)).toEqual([...all.map((i: { statusOn: string }) => i.statusOn)].sort().reverse());
    expect((await t.call("GET", "/api/restaurants?bbox=nope")).statusCode).toBe(400);
    const pending = (await t.call("GET", "/api/restaurants?q=shirdi")).json().items[0];
    expect(pending.location).toBeNull();
  });

  it("gives each map item its summary sentence, and counts matches without a location", async () => {
    const r = (await t.call("GET", "/api/restaurants?bbox=72.80,18.90,72.86,18.95")).json();
    expect(r.unlocated).toBe(1);
    expect(r.items.find((i: { id: number }) => i.id === 1).summary).toBe("Licence suspended by FDA Maharashtra on 16 Sept 2026. Not reinstated as of 22 Sept 2026.");
    expect((await t.call("GET", "/api/restaurants?bbox=72.80,18.90,72.86,18.95&q=harbour")).json().unlocated).toBe(0);
  });

  it("lists the latest official actions and the cities", async () => {
    const latest = (await t.call("GET", "/api/actions/latest?limit=3")).json().items;
    expect(latest[0]).toEqual({ restaurantId: 13, name: "Bandra Bao Co.", area: "Bandra West", city: "Mumbai", type: "imp", actionOn: "2026-09-22" });
    expect(latest).toHaveLength(3);
    expect((await t.call("GET", "/api/cities")).json().items).toEqual(["Ahilyanagar", "Mumbai", "Nagpur", "Navi Mumbai", "Pune", "Thane"]);
  });

  it("filters by badge", async () => {
    expect((await t.call("GET", "/api/restaurants?badge=verified")).json().items).toEqual([]);
    expect((await t.call("GET", "/api/restaurants?badge=none&limit=500")).json().items).toHaveLength(34);
  });

  it("builds the profile's plain summary sentence", async () => {
    expect((await t.call("GET", "/api/restaurants/1")).json().summary).toBe("Licence suspended by FDA Maharashtra on 16 Sept 2026. Not reinstated as of 22 Sept 2026.");
    expect((await t.call("GET", "/api/restaurants/101")).json().summary).toBe("No official action on record as of 22 Sept 2026. This is not a guarantee of hygiene.");
  });

  it("takes correction requests and place suggestions", async () => {
    const c = await t.call("POST", "/api/restaurants/5/corrections", { body: { role: "owner", message: "Licence restored on 20 Sep, order attached" } });
    expect(c.statusCode).toBe(201);
    expect(c.json().reference).toMatch(/^PW-C\d+$/);
    expect((await t.call("POST", "/api/place-suggestions", { body: { name: "Corner Pav Stall", area: "Sion" } })).statusCode).toBe(201);
  });
});

describe("admin", () => {
  it("is closed to everyone else", async () => {
    for (const url of ["/api/admin/summary", "/api/admin/evidence", "/api/admin/audit"]) {
      expect((await t.call("GET", url)).statusCode).toBe(401);
      expect((await t.call("GET", url, { cookie: user })).statusCode).toBe(403);
    }
  });

  it("records an official action, which moves the dot and pauses the score", async () => {
    const r = await t.call("POST", "/api/admin/restaurants/101/actions", {
      cookie: admin,
      body: { actionOn: "2026-09-24", type: "imp", summary: "No handwash station near prep area", sourceUrl: "https://fda.maharashtra.gov.in/sample" },
    });
    expect(r.statusCode).toBe(201);
    const p = (await t.call("GET", "/api/restaurants/101")).json();
    expect(p).toMatchObject({ status: "imp", dot: "amber", lastVerifiedOn: "2026-09-24" });
    expect(p.history[0]).toMatchObject({ type: "imp", sourceUrl: "https://fda.maharashtra.gov.in/sample" });
    expect((await t.call("POST", "/api/admin/restaurants/101/actions", { cookie: admin, body: { actionOn: "2026-09-24", type: "imp", summary: "x", sourceUrl: "javascript:alert(1)" } })).statusCode).toBe(400);
  });

  it("adds restaurants, refusing duplicate licences", async () => {
    const body = { name: "New Test Place", area: "Dadar West", city: "Mumbai", category: "Restaurant", licenceNumber: "11526000000777", location: { lat: 19.02, lng: 72.84 }, lastVerifiedOn: "2026-09-25" };
    const r = await t.call("POST", "/api/admin/restaurants", { cookie: admin, body });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBeGreaterThan(120);
    expect((await t.call("POST", "/api/admin/restaurants", { cookie: admin, body })).statusCode).toBe(409);
  });

  it("lists the checkup for the scoring tabs, and counts what's expiring", async () => {
    const c = (await t.call("GET", "/api/admin/catalog", { cookie: admin })).json();
    expect(c.categories).toHaveLength(7);
    expect(c.requirements).toHaveLength(27);
    expect(c.requirements[0]).toEqual({ id: "k1", categoryKey: "kitchen", text: "Food preparation areas are clean", weight: 2, critical: false });
    expect((await t.call("GET", "/api/admin/summary", { cookie: admin })).json()).toEqual({ pendingEvidence: 0, verificationRequests: 0, reportsToModerate: 0, expiringSoon: 0, licenceChecks: 35, claims: 0 });
  });

  it("edits weights and expiry, which flow into the score", async () => {
    expect((await t.call("PUT", "/api/admin/requirements/k1", { cookie: admin, body: { weight: 5, critical: true } })).statusCode).toBe(204);
    expect((await t.call("PUT", "/api/admin/requirements/k1", { cookie: admin, body: { weight: 9 } })).statusCode).toBe(400);
    expect((await t.call("PUT", "/api/admin/categories/kitchen", { cookie: admin, body: { expiryDays: 45 } })).statusCode).toBe(204);
    const c = (await t.call("GET", "/api/admin/catalog", { cookie: admin })).json();
    expect(c.requirements[0]).toMatchObject({ weight: 5, critical: true });
    expect(c.categories[0]).toMatchObject({ key: "kitchen", expiryDays: 45 });
  });

  it("keeps an append-only audit trail", async () => {
    const items = (await t.call("GET", "/api/admin/audit?entityType=restaurant&entityId=101", { cookie: admin })).json().items;
    expect(items.map((i: { action: string }) => i.action)).toContain("enforcement.add");
    /* drizzle wraps the database error; the trigger's message is on the cause */
    const appendOnly = { cause: expect.objectContaining({ message: "audit_log is append-only" }) };
    await expect(t.db.execute(sql`update audit_log set action = 'x'`)).rejects.toMatchObject(appendOnly);
    await expect(t.db.delete(auditLog).where(eq(auditLog.action, "enforcement.add"))).rejects.toMatchObject(appendOnly);
  });

  it("keeps the kitchen gallery off unless PUBLIC_GALLERY is on", async () => {
    expect((await t.call("GET", "/api/restaurants/3")).json().gallery).toEqual([]);
  });

  it("answers health checks", async () => {
    expect((await t.call("GET", "/api/health")).json()).toEqual({ ok: true });
  });
});
