/*
 * npm run import:osm -- --bbox 72.826,18.925,72.840,18.940 --city Mumbai [--area Fort] [--dry-run]
 * --area names the neighbourhood for places whose OSM entry doesn't say (many don't).
 * Fetches named restaurants, cafés and food stalls inside the box from OpenStreetMap (Overpass API) and imports them.
 * Keep boxes city-sized or smaller; the public Overpass server is shared and rate-limited.
 */
import { createDb } from "../src/db/client.js";
import { isoDateIST } from "../src/lib/dates.js";
import { importPlaces, overpassQuery, toPlace, type OsmElement } from "../src/modules/import/osm.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const bbox = (arg("bbox") ?? "").split(",").map(Number);
const city = arg("city") ?? "";
const area = arg("area") ?? "";
const dryRun = process.argv.includes("--dry-run");
if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)) || !city) {
  console.error("Usage: npm run import:osm -- --bbox minLng,minLat,maxLng,maxLat --city <City> [--area <Area>] [--dry-run]");
  process.exit(1);
}

const endpoint = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const res = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "PlateWatch importer (food-safety transparency; contact: support@platewatch.in)" },
  body: new URLSearchParams({ data: overpassQuery(bbox) }),
  signal: AbortSignal.timeout(120_000),
});
if (!res.ok) {
  console.error(`Overpass answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { elements } = (await res.json()) as { elements: OsmElement[] };
const places = elements.map((e) => toPlace(e, city, area)).filter((p) => p != null);
console.log(`OpenStreetMap returned ${elements.length} places; ${places.length} have a name, type and position.`);

if (dryRun) {
  for (const p of places.slice(0, 15)) console.log(`  ${p.name} · ${p.category} · ${p.area}, ${p.city} (${p.osmId})`);
  if (places.length > 15) console.log(`  … and ${places.length - 15} more`);
  console.log("Dry run: nothing saved.");
} else {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(url, 1);
  const r = await importPlaces(db, places, { today: isoDateIST(new Date()), actorId: null });
  await pool.end();
  console.log(`Imported: ${r.added} new, ${r.updated} updated. Data © OpenStreetMap contributors (ODbL).`);
}
