import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, type T } from "./helpers.js";

let t: T;
let owner: string, rival: string, admin: string;
const GREEN_LEAF = { id: 3, lic: "11525017000418" };

beforeAll(async () => {
  t = await setupApp();
  owner = await t.login("9811800001", { owner: true });
  rival = await t.login("9811800002", { owner: true });
  admin = await t.login("9811800003", { admin: true });
});
afterAll(async () => t.close());

const claimsOf = async (cookie: string) => (await t.call("GET", "/api/owner/claims", { cookie })).json().items;

describe("restaurant claims need staff approval", () => {
  it("needs the licence certificate, not just the number printed on the profile", async () => {
    const r = await t.call("POST", "/api/owner/claims", { cookie: owner, body: { restaurantId: GREEN_LEAF.id, licenceNumber: GREEN_LEAF.lic } });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/certificate/);
  });

  it("waits for staff: no dashboard yet, and no second claim from the same number", async () => {
    const r = await t.requestClaim(owner, GREEN_LEAF.id, GREEN_LEAF.lic);
    expect(r.json()).toMatchObject({ status: "pending" });
    expect((await t.call("GET", `/api/owner/restaurants/${GREEN_LEAF.id}/checkup`, { cookie: owner })).statusCode).toBe(404);
    expect((await t.requestClaim(owner, GREEN_LEAF.id, GREEN_LEAF.lic)).json().error).toBe("CLAIM_PENDING");
    expect(await claimsOf(owner)).toEqual([expect.objectContaining({ status: "pending", restaurant: expect.objectContaining({ id: GREEN_LEAF.id }), reviewBy: expect.any(String) })]);
  });

  it("shows staff the certificate, whether the number matches, and competing claims", async () => {
    await t.requestClaim(rival, GREEN_LEAF.id, GREEN_LEAF.lic);
    expect((await t.call("GET", "/api/admin/summary", { cookie: admin })).json().claims).toBe(2);
    const queue = (await t.call("GET", "/api/admin/claims", { cookie: admin })).json().items;
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ licenceMatches: true, claimant: "+91 98118 00001", otherClaims: 1, document: { kind: "document", url: expect.stringMatching(/^\/api\/dev\/storage\//) } });
    /* the same certificate file sent for the second claim */
    expect(queue[1].reuse).toMatchObject({ source: "claim", exact: true });
    expect((await t.call("GET", "/api/admin/claims", { cookie: owner })).statusCode).toBe(403);
  });

  it("needs a reason to turn a claim down, and tells the owner", async () => {
    const queue = (await t.call("GET", "/api/admin/claims", { cookie: admin })).json().items;
    const rivalClaim = queue.find((c: { claimant: string }) => c.claimant.endsWith("00002"));
    expect((await t.call("POST", `/api/admin/claims/${rivalClaim.id}/decision`, { cookie: admin, body: { decision: "reject" } })).statusCode).toBe(400);
    expect((await t.call("POST", `/api/admin/claims/${rivalClaim.id}/decision`, { cookie: admin, body: { decision: "reject", reason: "The certificate is for a different business" } })).statusCode).toBe(204);
    expect((await claimsOf(rival))[0]).toMatchObject({ status: "rejected", reviewNote: "The certificate is for a different business" });
  });

  it("approval opens the dashboard and turns down anyone else still waiting", async () => {
    const third = await t.login("9811800004", { owner: true });
    await t.requestClaim(third, GREEN_LEAF.id, GREEN_LEAF.lic);
    const mine = (await claimsOf(owner))[0];
    expect((await t.call("POST", `/api/admin/claims/${mine.id}/decision`, { cookie: admin, body: { decision: "approve" } })).statusCode).toBe(204);
    expect((await t.call("GET", `/api/owner/restaurants/${GREEN_LEAF.id}/checkup`, { cookie: owner })).statusCode).toBe(200);
    expect((await claimsOf(third))[0]).toMatchObject({ status: "rejected", reviewNote: "Another claim for this restaurant was approved." });
    expect((await t.call("POST", `/api/admin/claims/${mine.id}/decision`, { cookie: admin, body: { decision: "approve" } })).json().error).toBe("ALREADY_DECIDED");
    expect((await t.requestClaim(rival, GREEN_LEAF.id, GREEN_LEAF.lic)).json().error).toBe("ALREADY_CLAIMED");
  });
});
