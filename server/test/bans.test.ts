import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../src/db/schema.js";
import { setupApp, type T } from "./helpers.js";

let w: T;
let admin: string;
beforeAll(async () => {
  w = await setupApp();
  admin = await w.login("9855500001", { admin: true });
});
afterAll(async () => w.close());

const HOUR = 3_600_000;
const report = (cookie: string, restaurantId: number, text?: string) =>
  w.call("POST", "/api/reports", { cookie, body: { restaurantId, category: "Pests", share: true, ...(text ? { text } : {}) } });
const idOf = async (local: string) => (await w.db.select({ id: users.id }).from(users).where(eq(users.phone, "+91" + local)))[0]!.id;

describe("remarks", () => {
  it("take up to 1000 characters", async () => {
    const me = await w.login("9855500002");
    expect((await report(me, 1, "a".repeat(1001))).statusCode).toBe(400);
    expect((await report(me, 1, "a".repeat(1000))).statusCode).toBe(201);
  });
});

describe("false reports and bans", () => {
  it("shows each report's 24-hour deadline and the reporter's false reports this week", async () => {
    const liar = await w.login("9855500003");
    const sentAt = w.clock.now.getTime();
    const first = (await report(liar, 2)).json().id;
    w.advance(HOUR);
    const second = (await report(liar, 3)).json().id;
    w.advance(HOUR);
    await report(liar, 4);

    let list = (await w.call("GET", "/api/admin/reports", { cookie: admin })).json().items;
    const it1 = list.find((x: { id: string }) => x.id === first);
    expect(new Date(it1.verifyBy).getTime() - sentAt).toBe(24 * HOUR);
    expect(it1.reporterFalseThisWeek).toBe(0);

    /* a ban needs 2 false reports in the week */
    const liarId = await idOf("9855500003");
    expect((await w.call("POST", `/api/admin/reports/${first}/decision`, { cookie: admin, body: { decision: "false" } })).statusCode).toBe(204);
    expect((await w.call("POST", `/api/admin/users/${liarId}/ban`, { cookie: admin })).json().error).toBe("NOT_ENOUGH_FALSE_REPORTS");
    await w.call("POST", `/api/admin/reports/${second}/decision`, { cookie: admin, body: { decision: "false" } });

    list = (await w.call("GET", "/api/admin/reports", { cookie: admin })).json().items;
    expect(list.find((x: { reporterId: string }) => x.reporterId === liarId).reporterFalseThisWeek).toBe(2);

    /* only admins can ban */
    const other = await w.login("9855500004");
    expect((await w.call("POST", `/api/admin/users/${liarId}/ban`, { cookie: other })).statusCode).toBe(403);
    expect((await w.call("POST", `/api/admin/users/${liarId}/ban`, { cookie: admin })).statusCode).toBe(204);

    /* the open session stops working, no new code, no sign-in */
    expect((await w.call("GET", "/api/me", { cookie: liar })).json().user).toBeNull();
    expect((await report(liar, 7)).statusCode).toBe(401);
    const again = await w.call("POST", "/api/auth/otp/request", { body: { phone: "9855500003" }, ip: "10.9.9.9" });
    expect(again.statusCode).toBe(403);
    expect(again.json().message).toMatch(/grievance@platewatch\.in/);

    const banned = (await w.call("GET", "/api/admin/banned", { cookie: admin })).json().items;
    expect(banned).toHaveLength(1);
    expect(banned[0].phone).toBe("+91 98xxx xx003");

    /* unban lets them back in */
    expect((await w.call("POST", `/api/admin/users/${liarId}/unban`, { cookie: admin })).statusCode).toBe(204);
    expect((await w.call("POST", "/api/auth/otp/request", { body: { phone: "9855500003" }, ip: "10.9.9.9" })).statusCode).toBe(200);
  });

  it("forgets false reports older than 7 days", async () => {
    const me = await w.login("9855500005");
    const a = (await report(me, 5)).json().id;
    w.advance(HOUR);
    const b = (await report(me, 6)).json().id;
    await w.call("POST", `/api/admin/reports/${a}/decision`, { cookie: admin, body: { decision: "false" } });
    w.advance(8 * 24 * HOUR);
    await w.call("POST", `/api/admin/reports/${b}/decision`, { cookie: admin, body: { decision: "false" } });
    expect((await w.call("POST", `/api/admin/users/${await idOf("9855500005")}/ban`, { cookie: admin })).json().error).toBe("NOT_ENOUGH_FALSE_REPORTS");
  });
});
