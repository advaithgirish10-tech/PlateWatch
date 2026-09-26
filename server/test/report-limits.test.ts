import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, type T } from "./helpers.js";

let w: T;
beforeAll(async () => (w = await setupApp({ reportsPerDay: 1, reportsPerWeek: 5 })));
afterAll(async () => w.close());

describe("report limits per person", () => {
  it("allows 5 reports in any 7 days, one per restaurant per week", async () => {
    const me = await w.login("9844400009");
    const send = (restaurantId: number) => w.call("POST", "/api/reports", { cookie: me, body: { restaurantId, category: "Pests", share: true } });
    for (const id of [1, 2, 3, 4, 5]) {
      expect((await send(id)).statusCode).toBe(201);
      w.advance(24 * 3_600_000);
    }
    const sixth = await send(6);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe("WEEKLY_LIMIT");
    expect(sixth.json().message).toMatch(/^You've sent 5 reports this week\. You can send another from \d+ \w+, \d+:\d\d [ap]m\.$/);
    /* the same restaurant again within the week is refused on its own */
    w.advance(2 * 24 * 3_600_000 + 60_000);
    expect((await send(5)).json().error).toBe("ALREADY_REPORTED");
    /* more than 7 days after the first report, one more is allowed */
    expect((await send(6)).statusCode).toBe(201);
  });

});
