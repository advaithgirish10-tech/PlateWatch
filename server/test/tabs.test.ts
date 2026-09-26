import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, type T } from "./helpers.js";

let t: T;
beforeAll(async () => (t = await setupApp()));
afterAll(async () => t.close());

const HARBOUR = { id: 1, lic: "11526998000101" };

describe("user login and owner login are separate", () => {
  it("one browser can be a user in one tab and an owner in another", async () => {
    const user = await t.login("9877700001");
    const owner = await t.login("9877700001", { owner: true });
    /* both logins work side by side */
    expect((await t.call("GET", "/api/me", { cookie: user })).json().user).not.toBeNull();
    expect((await t.call("GET", "/api/me", { cookie: owner })).json().user).not.toBeNull();
    /* a tab only uses its own login: the user tab sends no owner header, so the owner cookie means nothing there */
    expect((await t.call("GET", "/api/me", { cookie: owner, headers: { "x-pw-mode": "user" } })).json().user).toBeNull();
    expect((await t.call("GET", "/api/me", { cookie: user, headers: { "x-pw-mode": "owner" } })).json().user).toBeNull();
  });

  it("the dashboard needs the owner login, and reports need the user login", async () => {
    const user = await t.login("9877700002");
    const owner = await t.login("9877700002", { owner: true });
    const admin = await t.login("9877700009", { admin: true });
    const r = await t.call("POST", "/api/owner/claims", { cookie: user, body: { restaurantId: HARBOUR.id, licenceNumber: HARBOUR.lic } });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/owner login/);
    await t.claimApproved(owner, admin, HARBOUR.id, HARBOUR.lic);
    expect((await t.call("GET", `/api/owner/restaurants/${HARBOUR.id}/checkup`, { cookie: user })).statusCode).toBe(403);
    expect((await t.call("GET", `/api/owner/restaurants/${HARBOUR.id}/checkup`, { cookie: owner })).statusCode).toBe(200);

    const send = (cookie: string) => t.call("POST", "/api/reports", { cookie, body: { restaurantId: 2, category: "Pests", share: true } });
    const fromOwner = await send(owner);
    expect(fromOwner.statusCode).toBe(403);
    expect(fromOwner.json().message).toMatch(/user login/);
    expect((await send(user)).statusCode).toBe(201);
  });

  it("logging out of one tab leaves the other signed in", async () => {
    const user = await t.login("9877700003");
    const owner = await t.login("9877700003", { owner: true });
    const out = await t.call("POST", "/api/auth/logout", { cookie: owner });
    expect(out.cookies.map((c) => c.name)).toEqual(["pw_owner"]);
    expect((await t.call("GET", "/api/me", { cookie: owner })).json().user).toBeNull();
    expect((await t.call("GET", "/api/me", { cookie: user })).json().user).not.toBeNull();
  });
});
