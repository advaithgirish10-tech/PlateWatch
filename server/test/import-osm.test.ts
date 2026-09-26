import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restaurants } from "../src/db/schema.js";
import { importPlaces, overpassQuery, toPlace, type OsmElement } from "../src/modules/import/osm.js";
import { setupApp, type T } from "./helpers.js";

let t: T;
beforeAll(async () => (t = await setupApp({ sample: false })));
afterAll(async () => t.close());

const EL: OsmElement[] = [
  { type: "node", id: 1, lat: 18.93, lon: 72.83, tags: { amenity: "restaurant", name: "Britannia Test", "addr:suburb": "Ballard Estate" } },
  { type: "way", id: 2, center: { lat: 18.931, lon: 72.831 }, tags: { amenity: "cafe", name: "Kala Test Cafe", "addr:city": "Mumbai" } },
  { type: "node", id: 3, lat: 18.9, lon: 72.8, tags: { amenity: "restaurant" } },
  { type: "node", id: 4, lat: 18.9, lon: 72.8, tags: { amenity: "bank", name: "Not food" } },
];

describe("OpenStreetMap import", () => {
  it("asks Overpass for named food places in the box, south-west-north-east", () => {
    expect(overpassQuery([72.8, 18.9, 72.9, 19.0])).toContain('["name"](18.9,72.8,19,72.9)');
  });

  it("keeps named food places with a position and fills area and city", () => {
    const places = EL.map((e) => toPlace(e, "Mumbai", "Fort")).filter((p) => p != null);
    expect(places).toEqual([
      { osmId: "node/1", name: "Britannia Test", area: "Ballard Estate", city: "Mumbai", category: "Restaurant", lat: 18.93, lng: 72.83 },
      { osmId: "way/2", name: "Kala Test Cafe", area: "Fort", city: "Mumbai", category: "Café", lat: 18.931, lng: 72.831 },
    ]);
  });

  it("imports once, updates on re-run, and never overwrites a restaurant staff edited", async () => {
    const places = EL.map((e) => toPlace(e, "Mumbai", "Fort")).filter((p) => p != null);
    expect(await importPlaces(t.db, places, { today: "2026-09-25", actorId: null })).toEqual({ added: 2, updated: 0 });
    expect(await importPlaces(t.db, places, { today: "2026-09-25", actorId: null })).toEqual({ added: 0, updated: 2 });
    const [row] = await t.db.select().from(restaurants).where(eq(restaurants.osmId, "node/1"));
    expect(row).toMatchObject({ source: "osm", licenceNumber: null, licenceStatus: null, currentStatus: null });
    await t.db.update(restaurants).set({ source: "staff", name: "Britannia & Co." }).where(eq(restaurants.osmId, "node/1"));
    await importPlaces(t.db, places, { today: "2026-09-25", actorId: null });
    const [kept] = await t.db.select().from(restaurants).where(eq(restaurants.osmId, "node/1"));
    expect(kept!.name).toBe("Britannia & Co.");
  });

  it("imported places are searchable without a licence number", async () => {
    const r = await t.call("GET", "/api/search?q=kala");
    expect(r.json().items).toEqual([expect.objectContaining({ name: "Kala Test Cafe", licenceNumber: null, licenceStatus: null, source: "osm" })]);
  });
});
