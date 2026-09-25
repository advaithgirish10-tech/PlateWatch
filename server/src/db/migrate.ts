/* npm run db:migrate — run before each deploy (App Platform pre-deploy job), never from the web process */
import { createDb, runMigrations } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, pool } = createDb(url, 1);
await runMigrations(db);
await pool.end();
console.log("Migrations applied.");
