/*
 * Restaurants from OpenStreetMap (names, types, map locations). OSM data is © OpenStreetMap contributors under the
 * ODbL: every page showing it credits OpenStreetMap. OSM has no FSSAI licence numbers: owners add theirs when they
 * claim, or staff add it, and staff then check it on FoSCoS.
 */
import { sql } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { restaurants } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const CATEGORY: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  fast_food: "Fast food",
  food_court: "Food court",
  ice_cream: "Ice cream",
};

/* Overpass QL for named food places inside a bounding box; only places currently tagged as open (amenity=…) match,
   so ones OSM marks as closed (disused:amenity, was:amenity) are left out */
export function overpassQuery([minLng, minLat, maxLng, maxLat]: number[]) {
  return `[out:json][timeout:90];
nwr["amenity"~"^(${Object.keys(CATEGORY).join("|")})$"]["name"](${minLat},${minLng},${maxLat},${maxLng});
out center tags;`;
}

export interface OsmPlace {
  osmId: string;
  name: string;
  area: string;
  city: string;
  category: string;
  lat: number;
  lng: number;
}

/* one OSM element as a restaurant row, or null when it lacks a name, type or position */
export function toPlace(el: OsmElement, fallbackCity: string, fallbackArea = ""): OsmPlace | null {
  const t = el.tags ?? {};
  const name = (t.name ?? "").trim();
  const category = CATEGORY[t.amenity ?? ""];
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!name || !category || lat == null || lng == null) return null;
  const city = (t["addr:city"] ?? "").trim() || fallbackCity;
  const area = (t["addr:suburb"] ?? t["addr:neighbourhood"] ?? t["addr:district"] ?? t["addr:place"] ?? "").trim() || fallbackArea || city;
  return { osmId: `${el.type}/${el.id}`, name: name.slice(0, 120), area: area.slice(0, 120), city: city.slice(0, 80), category, lat, lng };
}

/* insert new places and refresh ones imported before; a restaurant staff created or edited by hand is never overwritten */
export async function importPlaces(db: Queryable, places: OsmPlace[], meta: { today: string; actorId: string | null }) {
  let added = 0,
    updated = 0;
  for (const p of places) {
    const [row] = await db
      .insert(restaurants)
      .values({
        name: p.name,
        area: p.area,
        city: p.city,
        category: p.category,
        location: { x: p.lng, y: p.lat },
        lastVerifiedOn: meta.today,
        source: "osm",
        osmId: p.osmId,
      })
      .onConflictDoUpdate({
        target: restaurants.osmId,
        set: { name: p.name, area: p.area, city: p.city, category: p.category, location: { x: p.lng, y: p.lat }, updatedAt: new Date() },
        setWhere: sql`${restaurants.source} = 'osm'`,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (!row) continue;
    if (row.inserted) added++;
    else updated++;
  }
  await audit(db, { actorId: meta.actorId, action: "restaurant.import_osm", entityType: "import", entityId: meta.today, data: { added, updated } });
  return { added, updated };
}
