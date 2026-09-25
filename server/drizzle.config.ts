import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

/* drizzle-kit doesn't read .env itself; the database URL (and its password) live there */
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://platewatch:platewatch@localhost:5432/platewatch" },
  /* PostGIS owns spatial_ref_sys; never diff or drop it */
  extensionsFilters: ["postgis"],
});
