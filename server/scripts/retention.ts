/* Deletes checkup photos older than 4 months and PDFs older than 2 years. The API also does this every 6 hours. */
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { purgeOldEvidence } from "../src/jobs/retention.js";
import { storageFromConfig } from "../src/storage/storage.js";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const storage = storageFromConfig(config);
const r = await purgeOldEvidence({ config, db, storage, otp: { send: async () => "console" }, now: () => new Date() });
console.log(`Deleted ${r.images} photo/video file(s) and ${r.documents} PDF(s).`);
await pool.end();
