import path from "node:path";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema.js";

export type DB = NodePgDatabase<typeof schema>;
/* a transaction handle has the same query API as the database */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Queryable = DB | Tx;

/*
 * Managed databases (DigitalOcean) sign their TLS certificate with their own CA. With DATABASE_CA_CERT set, the
 * connection is encrypted and the server's certificate is verified against that CA. The URL's sslmode is dropped
 * then, because the driver lets the URL override these settings.
 */
export function createDb(url: string, max = 10, caCert = process.env.DATABASE_CA_CERT) {
  let connectionString = url;
  let ssl: pg.PoolConfig["ssl"];
  if (caCert) {
    const u = new URL(url);
    for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) u.searchParams.delete(k);
    connectionString = u.toString();
    ssl = { ca: caCert.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  }
  const pool = new pg.Pool({ connectionString, max, ssl });
  return { db: drizzle(pool, { schema }), pool };
}

export async function runMigrations(db: DB, dir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "drizzle")) {
  await migrate(db, { migrationsFolder: dir });
}
