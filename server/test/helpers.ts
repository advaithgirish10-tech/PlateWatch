import { sql } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { seedCatalog, seedSampleRestaurants } from "../src/db/seed.js";
import { memoryStorage } from "../src/storage/storage.js";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";

/* the test database sits next to the development one, with the same user and password (from .env) */
if (existsSync(".env")) process.loadEnvFile(".env");
export const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL?.replace(/\/[^/?]*(\?.*)?$/, "/platewatch_test$1") ??
  "postgres://platewatch:platewatch@localhost:5432/platewatch_test";
export const ORIGIN = "http://localhost:5173";

export async function setupApp(opts: { sample?: boolean; gallery?: boolean } = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    OTP_PEPPER: "test-pepper-0123456789",
    OTP_CHANNEL: "console",
    STORAGE: "memory",
    ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_GALLERY: opts.gallery ? "true" : "false",
  });
  const { db, pool } = createDb(TEST_DB, 5);
  /* empty every table; replica mode skips the audit log's append-only triggers for this reset only */
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    const { rows } = await tx.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys'`);
    await tx.execute(sql.raw(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`));
  });
  await seedCatalog(db);
  if (opts.sample !== false) await seedSampleRestaurants(db);

  const clock = { now: new Date("2026-09-25T06:30:00Z") };
  const sent: { phone: string; code: string }[] = [];
  const storage = memoryStorage(() => clock.now);
  const app = await buildApp({
    config,
    db,
    storage,
    otp: { send: async (phone, code) => (sent.push({ phone, code }), "console") },
    now: () => clock.now,
  }, { rateLimit: false });

  const advance = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
  const lastCode = (phone: string) => [...sent].reverse().find((s) => s.phone === phone)?.code;

  /* a request as a browser on the site would send it */
  const call = (method: InjectOptions["method"], url: string, o: { body?: unknown; cookie?: string; headers?: Record<string, string>; ip?: string } = {}) =>
    app.inject({
      method,
      url,
      remoteAddress: o.ip ?? "127.0.0.1",
      payload: o.body as InjectOptions["payload"],
      headers: { origin: ORIGIN, ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers },
    });

  /* sign in a number and return its session cookie */
  async function login(local: string, o: { admin?: boolean } = {}) {
    /* each number signs in from its own address, so the per-address OTP limit doesn't trip */
    const ip = `10.${+local.slice(-6, -4)}.${+local.slice(-4, -2)}.${+local.slice(-2)}`;
    const r1 = await call("POST", "/api/auth/otp/request", { body: { phone: local }, ip });
    if (r1.statusCode !== 200) throw new Error(`OTP request failed: ${r1.body}`);
    const r2 = await call("POST", "/api/auth/otp/verify", { body: { phone: local, code: lastCode("+91" + local), consent: true }, ip });
    if (r2.statusCode !== 200) throw new Error(`OTP verify failed: ${r2.body}`);
    const c = r2.cookies.find((x) => x.name === "pw_session")!;
    if (o.admin) await db.update(users).set({ role: "admin" }).where(eq(users.phone, "+91" + local));
    advance(31_000);
    return `pw_session=${c.value}`;
  }

  /* upload a file the way the browser does: ask for a URL, PUT the bytes to it */
  async function upload(cookie: string, purpose: "evidence" | "report" | "response", body: Buffer, contentType: string, filename = "file") {
    const r = await call("POST", "/api/uploads", { cookie, body: { purpose, contentType, size: body.length, filename } });
    if (r.statusCode !== 201) return { res: r, uploadId: null as string | null };
    const { uploadId, url, headers } = r.json();
    const put = await app.inject({ method: "PUT", url, payload: body, headers: { ...headers, origin: ORIGIN } });
    if (put.statusCode !== 200) throw new Error(`PUT failed: ${put.body}`);
    return { res: r, uploadId: uploadId as string };
  }

  return { app, db, pool, storage, sent, clock, advance, lastCode, call, login, upload, close: async () => (await app.close(), await pool.end()) };
}

export type T = Awaited<ReturnType<typeof setupApp>>;

/* a real JPEG carrying EXIF with a GPS position, to prove uploads strip it */
export async function jpegWithGps() {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCam", Model: "Leaky 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 4/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "72/1 52/1 0/1" } })
    .toBuffer();
}
