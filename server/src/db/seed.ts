/* npm run db:seed — the 27-item checkup (always) and the prototype's fictional restaurants (unless --catalog-only). Safe to re-run. */
import { eq, sql } from "drizzle-orm";
import { addEnforcementAction } from "../modules/restaurants/service.js";
import { createDb, type DB } from "./client.js";
import { CATEGORIES, REQUIREMENTS, RESTAURANTS } from "./sample-data.js";
import { requirementCategories, requirements, restaurants } from "./schema.js";

export async function seedCatalog(db: DB) {
  for (const [i, c] of CATEGORIES.entries()) {
    await db
      .insert(requirementCategories)
      .values({ ...c, sort: i })
      .onConflictDoUpdate({ target: requirementCategories.key, set: { name: c.name, sort: i } });
  }
  for (const [i, [id, categoryKey, text, weight, critical]] of REQUIREMENTS.entries()) {
    await db.insert(requirements).values({ id, categoryKey, text, weight, critical, sort: i }).onConflictDoUpdate({ target: requirements.id, set: { text, sort: i } });
  }
}

export async function seedSampleRestaurants(db: DB) {
  let added = 0;
  for (const r of RESTAURANTS) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(restaurants)
        .values({
          id: r.id,
          name: r.name,
          area: r.area,
          city: r.city,
          category: r.category,
          licenceNumber: r.licenceNumber,
          location: r.location ? { x: r.location.lng, y: r.location.lat } : null,
          lastVerifiedOn: r.lastVerifiedOn,
          isSample: true,
        })
        .onConflictDoNothing()
        .returning({ id: restaurants.id });
      if (!row) return;
      added++;
      for (const [actionOn, type, summary] of r.actions) await addEnforcementAction(tx, { restaurantId: r.id, actionOn, type, summary, actorId: null });
      /* actions move lastVerifiedOn forward; keep the sample's own date */
      await tx.update(restaurants).set({ lastVerifiedOn: r.lastVerifiedOn }).where(eq(restaurants.id, r.id));
    });
  }
  /* explicit IDs were inserted, so move the sequence past them */
  await db.execute(sql`select setval(pg_get_serial_sequence('restaurants', 'id'), greatest((select max(id) from restaurants), 1))`);
  return added;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(url, 1);
  await seedCatalog(db);
  const added = process.argv.includes("--catalog-only") ? 0 : await seedSampleRestaurants(db);
  await pool.end();
  console.log(`Checkup catalog seeded. Sample restaurants added: ${added}.`);
}
