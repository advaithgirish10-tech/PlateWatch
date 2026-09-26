import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifications } from "../src/db/schema.js";
import { deliverPending, scanDeadlines, scanDue } from "../src/modules/notifications/delivery.js";
import { jpegWithGps, setupApp, texturedJpeg, type T } from "./helpers.js";

let t: T;
let owner: string, ownerAsUser: string, diner: string, follower: string, admin: string;
const BANDRA = { id: 13, lic: "11526027001589" };
const HOUR = 3_600_000;
const deps = () => ({ ...t.app.deps, now: () => t.clock.now });
const silentLog = { warn: () => {}, info: () => {}, error: () => {} } as never;

beforeAll(async () => {
  t = await setupApp();
  owner = await t.login("9855600001", { owner: true });
  ownerAsUser = await t.login("9855600001");
  diner = await t.login("9855600002");
  follower = await t.login("9855600003");
  admin = await t.login("9855600004", { admin: true });
  await t.call("PUT", `/api/me/follows/${BANDRA.id}`, { cookie: follower });
});
afterAll(async () => t.close());

const inbox = async (cookie: string) => (await t.call("GET", "/api/me/notifications", { cookie })).json();
const titles = async (cookie: string) => (await inbox(cookie)).items.map((n: { title: string }) => n.title);

describe("who hears about what", () => {
  it("staff hear about a new claim; the owner hears when it's approved, in the owner tab only", async () => {
    const c = await t.requestClaim(owner, BANDRA.id, BANDRA.lic);
    expect(await titles(admin)).toContain("New claim: Bandra Bao Co.");
    await t.call("POST", `/api/admin/claims/${c.json().claimId}/decision`, { cookie: admin, body: { decision: "approve" } });
    expect(await titles(owner)).toContain("Your claim for Bandra Bao Co. is approved");
    /* the same person's user tab doesn't show owner notifications */
    expect(await titles(ownerAsUser)).not.toContain("Your claim for Bandra Bao Co. is approved");
  });

  let reportId: number;
  it("an accepted report: the diner, the owner and followers are told", async () => {
    const { uploadId } = await t.upload(diner, "report", await texturedJpeg(1), "image/jpeg");
    const r = await t.call("POST", "/api/reports", { cookie: diner, body: { restaurantId: BANDRA.id, category: "Pests", text: "Cockroach on the idli counter.", share: true, evidence: [{ uploadId }] } });
    reportId = r.json().id;
    await t.call("POST", `/api/admin/reports/${reportId}/decision`, { cookie: admin, body: { decision: "accept" } });
    expect(await titles(diner)).toContain(`Report PW-${4100 + reportId} accepted`);
    expect(await titles(owner)).toContain("New report about Bandra Bao Co.");
    expect(await titles(follower)).toContain("New report about Bandra Bao Co.");
  });

  it("the restaurant's approved proof reaches the diner and followers", async () => {
    const { uploadId } = await t.upload(owner, "response", await jpegWithGps(), "image/jpeg");
    await t.call("POST", `/api/owner/restaurants/${BANDRA.id}/reports/${reportId}/response`, { cookie: owner, body: { text: "Pest control done this morning.", uploadId } });
    await t.call("POST", `/api/admin/reports/${reportId}/resolution`, { cookie: admin, body: { decision: "approve" } });
    expect(await titles(diner)).toContain(`Bandra Bao Co. took action on your report PW-${4100 + reportId}`);
    expect(await titles(follower)).toContain("Bandra Bao Co. fixed a reported problem");
    expect(await titles(owner)).toContain(`Your proof on PW-${4100 + reportId} was approved`);
  });

  it("a report that can't be used tells the diner why", async () => {
    t.advance(24 * HOUR);
    const r = await t.call("POST", "/api/reports", { cookie: diner, body: { restaurantId: 2, category: "Other", share: true } });
    await t.call("POST", `/api/admin/reports/${r.json().id}/decision`, { cookie: admin, body: { decision: "reject", reason: "Not enough detail to act on" } });
    const n = (await inbox(diner)).items.find((x: { title: string }) => x.title.endsWith("couldn't be used"));
    expect(n.body).toBe("Reason: Not enough detail to act on.");
  });

  it("marks notifications read", async () => {
    expect((await inbox(diner)).unread).toBeGreaterThan(0);
    await t.call("POST", "/api/me/notifications/read", { cookie: diner, body: {} });
    expect((await inbox(diner)).unread).toBe(0);
  });
});

describe("deadlines and due dates", () => {
  it("warns staff 4 hours before a review deadline, then when it's missed, once each", async () => {
    const r = await t.call("POST", "/api/reports", { cookie: follower, body: { restaurantId: 5, category: "Hygiene", share: true } });
    const ref = `PW-${4100 + r.json().id}`;
    await scanDeadlines(deps());
    expect((await titles(admin)).some((x: string) => x.includes(ref))).toBe(false);
    t.advance(21 * HOUR);
    await scanDeadlines(deps());
    await scanDeadlines(deps());
    expect((await titles(admin)).filter((x: string) => x.includes(ref))).toEqual([`Due in 3 h: Report ${ref} about Spice Route Kitchen`]);
    t.advance(4 * HOUR);
    await scanDeadlines(deps());
    expect((await titles(admin)).filter((x: string) => x.startsWith("Overdue") && x.includes(ref))).toHaveLength(1);
  });

  it("reminds owners before evidence is due, and when it's overdue", async () => {
    const { uploadId } = await t.upload(owner, "evidence", await texturedJpeg(9), "image/jpeg");
    await t.call("POST", `/api/owner/restaurants/${BANDRA.id}/evidence`, { cookie: owner, body: { requirementId: "k1", uploadId } });
    t.advance(12 * 24 * HOUR);
    await scanDue(deps());
    expect(await titles(owner)).toContain("Kitchen hygiene photos due in 2 days");
    t.advance(3 * 24 * HOUR);
    await scanDue(deps());
    await scanDue(deps());
    expect((await titles(owner)).filter((x: string) => x === "Kitchen hygiene is overdue at Bandra Bao Co.")).toHaveLength(1);
  });
});

describe("sending", () => {
  it("sends each outside-the-site notification once, and retries failures up to 5 times", async () => {
    const got: string[] = [];
    let failing = true;
    const messenger = { send: async (phone: string, title: string) => { if (failing) throw new Error("WhatsApp down"); got.push(`${phone} ${title}`); } };
    for (let i = 0; i < 2; i++) await deliverPending(deps(), messenger, silentLog);
    const [one] = await t.db.select().from(notifications).where(eq(notifications.external, true)).limit(1);
    expect(one!.sendAttempts).toBe(2);
    expect(one!.sentAt).toBeNull();
    failing = false;
    await deliverPending(deps(), messenger, silentLog);
    await deliverPending(deps(), messenger, silentLog);
    const rows = await t.db.select().from(notifications);
    expect(rows.filter((n) => n.external).every((n) => n.sentAt)).toBe(true);
    expect(rows.filter((n) => !n.external).every((n) => !n.sentAt)).toBe(true);
    expect(got.length).toBe(rows.filter((n) => n.external).length);
    expect(got).toContain("+919855600001 Your claim for Bandra Bao Co. is approved");
  });
});
