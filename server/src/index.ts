import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { otpSenderFromConfig, type OtpSender } from "./messaging/otp-sender.js";
import { memoryStorage, s3Storage } from "./storage/storage.js";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const storage = config.STORAGE === "s3" ? s3Storage(config) : memoryStorage();
/* the sender needs the app's logger, so it's attached once the app exists */
const otp: OtpSender = { send: (phone, code) => real.send(phone, code) };
/* fail at startup, with the fix in the message, rather than on the first request */
try {
  await pool.query("select 1");
} catch (err) {
  const msg = (err as Error).message;
  console.error(
    /certificate/i.test(msg)
      ? `Can't verify the database's TLS certificate (${msg}). Set DATABASE_CA_CERT to your provider's CA certificate: on DigitalOcean App Platform use \${db.CA_CERT}; Supabase has it under Project Settings → Database.`
      : `Can't reach the database: ${msg}`,
  );
  process.exit(1);
}
const app = await buildApp({ config, db, storage, otp, now: () => new Date() });
const real = otpSenderFromConfig(config, app.log);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
