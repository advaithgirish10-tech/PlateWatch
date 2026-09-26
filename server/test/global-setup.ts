import { sql } from "drizzle-orm";
import { createDb, runMigrations } from "../src/db/client.js";
import { TEST_DB } from "./helpers.js";

/* a fresh schema for every run: drop everything, then apply the real migrations */
export default async function setup() {
  const { db, pool } = createDb(TEST_DB, 1);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  await pool.end();
}
