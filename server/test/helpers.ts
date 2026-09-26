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

export async function setupApp(opts: { sample?: boolean; gallery?: boolean; reportsPerDay?: number; reportsPerWeek?: number } = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    OTP_PEPPER: "test-pepper-0123456789",
    OTP_CHANNEL: "console",
    STORAGE: "memory",
    ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_GALLERY: opts.gallery ? "true" : "false",
    REPORTS_PER_DAY: String(opts.reportsPerDay ?? 5),
    REPORTS_PER_WEEK: String(opts.reportsPerWeek ?? 50),
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
  /* a stand-in face detector: tests set the faces it "finds", or make it fail */
  const faces = { boxes: [] as { x: number; y: number; width: number; height: number }[], fail: false };
  const app = await buildApp({
    config,
    db,
    storage,
    otp: { send: async (phone, code) => (sent.push({ phone, code }), "console") },
    faces: {
      detect: async () => {
        if (faces.fail) throw new Error("detector down");
        return faces.boxes;
      },
    },
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
      /* the owner tab's requests say so, and carry the owner cookie */
      headers: { origin: ORIGIN, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.cookie?.startsWith("pw_owner=") ? { "x-pw-mode": "owner" } : {}), ...o.headers },
    });

  /* sign in a number and return its session cookie; owner: true signs in as the owner tab does */
  async function login(local: string, o: { admin?: boolean; owner?: boolean } = {}) {
    /* each number signs in from its own address, so the per-address OTP limit doesn't trip */
    const ip = `10.${+local.slice(-6, -4)}.${+local.slice(-4, -2)}.${+local.slice(-2)}`;
    const r1 = await call("POST", "/api/auth/otp/request", { body: { phone: local }, ip });
    if (r1.statusCode !== 200) throw new Error(`OTP request failed: ${r1.body}`);
    const r2 = await call("POST", "/api/auth/otp/verify", { body: { phone: local, code: lastCode("+91" + local), consent: true }, ip, headers: o.owner ? { "x-pw-mode": "owner" } : {} });
    if (r2.statusCode !== 200) throw new Error(`OTP verify failed: ${r2.body}`);
    const name = o.owner ? "pw_owner" : "pw_session";
    const c = r2.cookies.find((x) => x.name === name)!;
    if (o.admin) await db.update(users).set({ role: "admin" }).where(eq(users.phone, "+91" + local));
    advance(31_000);
    return `${name}=${c.value}`;
  }

  /* upload a file the way the browser does: ask for a URL, PUT the bytes to it */
  async function upload(cookie: string, purpose: "evidence" | "report" | "response" | "claim", body: Buffer, contentType: string, filename = "file") {
    const r = await call("POST", "/api/uploads", { cookie, body: { purpose, contentType, size: body.length, filename } });
    if (r.statusCode !== 201) return { res: r, uploadId: null as string | null };
    const { uploadId, url, headers } = r.json();
    const put = await app.inject({ method: "PUT", url, payload: body, headers: { ...headers, origin: ORIGIN } });
    if (put.statusCode !== 200) throw new Error(`PUT failed: ${put.body}`);
    return { res: r, uploadId: uploadId as string };
  }

  /* claim a restaurant the way an owner does: the licence number and a copy of the certificate */
  async function requestClaim(cookie: string, restaurantId: number, licenceNumber: string) {
    const { uploadId } = await upload(cookie, "claim", samplePdf(), "application/pdf", "fssai-licence.pdf");
    return call("POST", "/api/owner/claims", { cookie, body: { restaurantId, licenceNumber, uploadId } });
  }
  /* …and have PlateWatch staff approve it */
  async function claimApproved(cookie: string, adminCookie: string, restaurantId: number, licenceNumber: string) {
    const r = await requestClaim(cookie, restaurantId, licenceNumber);
    if (r.statusCode !== 202) throw new Error(`claim failed: ${r.body}`);
    const d = await call("POST", `/api/admin/claims/${r.json().claimId}/decision`, { cookie: adminCookie, body: { decision: "approve" } });
    if (d.statusCode !== 204) throw new Error(`approval failed: ${d.body}`);
    return r;
  }

  return { app, db, pool, storage, faces, sent, clock, requestClaim, claimApproved, advance, lastCode, call, login, upload, close: async () => (await app.close(), await pool.end()) };
}

export type T = Awaited<ReturnType<typeof setupApp>>;

/* a minimal PDF: the server checks the file really starts like one */
export const samplePdf = () => Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

/* a photo with detail, different for each seed; the same seed gives the same picture */
export async function texturedJpeg(seed: number, size = 96) {
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = (Math.sin((x + seed * 7) / (3 + (seed % 5))) + Math.cos((y * (seed % 3 + 1)) / 4) + Math.sin((x * y + seed * 13) / 50)) * 42 + 128;
      px.set([v, (v + seed * 31) % 256, 255 - v], (y * size + x) * 3);
    }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
}

/* a real JPEG carrying EXIF with a GPS position, to prove uploads strip it */
export async function jpegWithGps() {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCam", Model: "Leaky 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 4/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "72/1 52/1 0/1" } })
    .toBuffer();
}
