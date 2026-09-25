import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, follows, otpChallenges, reports, users } from "../src/db/schema.js";
import { setupApp, type T } from "./helpers.js";

let t: T;
beforeAll(async () => (t = await setupApp()));
afterAll(async () => t.close());

const request = (phone: string, ip = "127.0.0.1") => t.call("POST", "/api/auth/otp/request", { body: { phone }, ip });
const verify = (phone: string, code: string | undefined, consent?: boolean) => t.call("POST", "/api/auth/otp/verify", { body: { phone, code, consent } });

describe("OTP login", () => {
  it("rejects numbers that aren't Indian mobiles", async () => {
    for (const bad of ["12345", "5876543210", "98765432101", "abcdefghij"]) {
      expect((await request(bad)).statusCode).toBe(400);
    }
  });

  it("accepts +91, 91 and 0 prefixes and spaces", async () => {
    const r = await request("+91 90000 00001");
    expect(r.statusCode).toBe(200);
    expect(t.lastCode("+919000000001")).toMatch(/^\d{6}$/);
    expect(r.json()).toMatchObject({ channel: "console", expiresInSeconds: 600, resendInSeconds: 30 });
    /* the code itself is only echoed when OTP_DEV_ECHO is on */
    expect(r.json().devCode).toBeUndefined();
  });

  it("stores only a hash of the code", async () => {
    await request("9000000002");
    const code = t.lastCode("+919000000002")!;
    const [row] = await t.db.select().from(otpChallenges).where(eq(otpChallenges.phone, "+919000000002"));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash).toHaveLength(64);
  });

  it("allows three wrong tries, then the code stops working", async () => {
    await request("9000000003");
    const code = t.lastCode("+919000000003")!;
    const wrong = code === "000000" ? "111111" : "000000";
    const a = await verify("9000000003", wrong, true);
    expect(a.statusCode).toBe(400);
    expect(a.json().details.triesLeft).toBe(2);
    expect((await verify("9000000003", wrong, true)).json().details.triesLeft).toBe(1);
    const c = await verify("9000000003", wrong, true);
    expect(c.statusCode).toBe(429);
    expect(c.json().error).toBe("TOO_MANY_ATTEMPTS");
    /* even the right code is dead now */
    expect((await verify("9000000003", code, true)).json().details.code).toBe("CODE_EXPIRED");
  });

  it("makes you wait 30 seconds to resend, and only the newest code works", async () => {
    await request("9000000004");
    const first = t.lastCode("+919000000004")!;
    const again = await request("9000000004");
    expect(again.statusCode).toBe(429);
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(0);
    t.advance(31_000);
    expect((await request("9000000004")).statusCode).toBe(200);
    const second = t.lastCode("+919000000004")!;
    if (first !== second) expect((await verify("9000000004", first, true)).statusCode).toBe(400);
    expect((await verify("9000000004", second, true)).statusCode).toBe(200);
  });

  it("expires codes after 10 minutes", async () => {
    await request("9000000005");
    const code = t.lastCode("+919000000005")!;
    t.advance(10 * 60_000 + 1000);
    expect((await verify("9000000005", code, true)).json().details.code).toBe("CODE_EXPIRED");
  });

  it("caps codes at 5 per number per hour", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request("9000000006", `10.0.0.${i + 1}`)).statusCode).toBe(200);
      t.advance(31_000);
    }
    const sixth = await request("9000000006", "10.0.0.9");
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe("TOO_MANY_CODES");
  });

  it("caps codes at 20 per network per hour", async () => {
    for (let i = 0; i < 20; i++) expect((await request(`91000000${String(i).padStart(2, "0")}`, "10.9.9.9")).statusCode).toBe(200);
    expect((await request("9100000099", "10.9.9.9")).statusCode).toBe(429);
  });

  it("needs consent from a new number, then signs in with a secure session cookie", async () => {
    await request("9000000007");
    const code = t.lastCode("+919000000007")!;
    const noConsent = await verify("9000000007", code);
    expect(noConsent.json().details.code).toBe("CONSENT_REQUIRED");
    const ok = await verify("9000000007", code, true);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ phone: "+919000000007", displayPhone: "+91 90000 00007", role: "user" });
    const cookie = ok.cookies.find((c) => c.name === "pw_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    const me = await t.call("GET", "/api/me", { cookie: `pw_session=${cookie.value}` });
    expect(me.json().user.phone).toBe("+919000000007");
    const [u] = await t.db.select().from(users).where(eq(users.phone, "+919000000007"));
    expect(u!.consentVersion).toBe("2026-09-v1");
  });

  it("can't use one code twice", async () => {
    await request("9000000008");
    const code = t.lastCode("+919000000008")!;
    expect((await verify("9000000008", code, true)).statusCode).toBe(200);
    expect((await verify("9000000008", code, true)).statusCode).toBe(400);
  });

  it("logs out by revoking the session", async () => {
    const cookie = await t.login("9000000009");
    expect((await t.call("GET", "/api/me", { cookie })).json().user).not.toBeNull();
    expect((await t.call("POST", "/api/auth/logout", { cookie })).statusCode).toBe(204);
    expect((await t.call("GET", "/api/me", { cookie })).json().user).toBeNull();
  });

  it("refuses state-changing requests from other sites", async () => {
    const r = await t.call("POST", "/api/auth/otp/request", { body: { phone: "9000000010" }, headers: { origin: "https://evil.example" } });
    expect(r.statusCode).toBe(403);
  });

  it("returns 401 on protected routes without a session", async () => {
    expect((await t.call("GET", "/api/me/follows")).statusCode).toBe(401);
    expect((await t.call("POST", "/api/reports", { body: {} })).statusCode).toBe(401);
  });
});

describe("account", () => {
  it("updates name and alerts; name is stored as text", async () => {
    const cookie = await t.login("9000000011");
    const r = await t.call("PATCH", "/api/me", { cookie, body: { name: "  Asha <b>K</b>  ", whatsappAlerts: false } });
    expect(r.json().user).toMatchObject({ name: "Asha <b>K</b>", whatsappAlerts: false });
  });

  it("follows and unfollows places, and watches areas", async () => {
    const cookie = await t.login("9000000012");
    expect((await t.call("PUT", "/api/me/follows/7", { cookie })).statusCode).toBe(204);
    expect((await t.call("PUT", "/api/me/follows/7", { cookie })).statusCode).toBe(204);
    expect((await t.call("PUT", "/api/me/follows/9999", { cookie })).statusCode).toBe(404);
    const list = (await t.call("GET", "/api/me/follows", { cookie })).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 7, name: "Coastal Tiffin Centre", dot: "red" });
    expect((await t.call("DELETE", "/api/me/follows/7", { cookie })).statusCode).toBe(204);
    expect((await t.call("GET", "/api/me/follows", { cookie })).json().items).toHaveLength(0);

    expect((await t.call("POST", "/api/me/areas", { cookie, body: { area: "Dadar West" } })).statusCode).toBe(201);
    expect((await t.call("POST", "/api/me/areas", { cookie, body: { area: "dadar west" } })).statusCode).toBe(200);
    const areas = (await t.call("GET", "/api/me/areas", { cookie })).json().items;
    expect(areas).toEqual([expect.objectContaining({ area: "Dadar West", actions: 1 })]);
  });

  it("deletes the account: follows and sessions go, reports stay without the reporter", async () => {
    const cookie = await t.login("9000000013");
    await t.call("PUT", "/api/me/follows/3", { cookie });
    const rep = await t.call("POST", "/api/reports", { cookie, body: { restaurantId: 3, category: "Hygiene", share: true } });
    expect(rep.statusCode).toBe(201);
    const del = await t.call("DELETE", "/api/me", { cookie });
    expect(del.statusCode).toBe(204);
    expect((await t.call("GET", "/api/me", { cookie })).json().user).toBeNull();
    expect(await t.db.select().from(users).where(eq(users.phone, "+919000000013"))).toHaveLength(0);
    expect(await t.db.select().from(otpChallenges).where(eq(otpChallenges.phone, "+919000000013"))).toHaveLength(0);
    const [r] = await t.db.select().from(reports).where(eq(reports.id, rep.json().id));
    expect(r!.userId).toBeNull();
    expect(await t.db.select().from(follows)).toHaveLength(0);
    expect((await t.db.select().from(auditLog).where(eq(auditLog.action, "user.delete"))).length).toBe(1);
  });
});
