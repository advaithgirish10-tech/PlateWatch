import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { uploads } from "../../db/schema.js";
import { startOfDayIST } from "../../lib/dates.js";
import { HttpError, badRequest, conflict, tooMany } from "../../lib/errors.js";
import { blurFaces, dhash } from "../../storage/faces.js";
import { EXT, PDF, isImage, maxBytesFor, sanitizeImage, sniff, type AllowedType } from "../../storage/files.js";
import type { Deps } from "../../types.js";

export type Purpose = "evidence" | "report" | "response" | "claim";

const ALLOWED: Record<Purpose, AllowedType[]> = {
  evidence: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", PDF],
  report: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", PDF],
  response: ["image/jpeg", "image/png", "image/webp", PDF],
  /* the FSSAI licence certificate: a PDF or a photo of it */
  claim: ["image/jpeg", "image/png", "image/webp", PDF],
};
const PUT_TTL_SECONDS = 300;
const CLAIM_WITHIN_MS = 24 * 3_600_000;

export async function createUpload(deps: Deps, userId: string, isAdmin: boolean, input: { purpose: Purpose; contentType: string; size: number; filename: string }) {
  const { db, config } = deps;
  const now = deps.now();
  const type = input.contentType.toLowerCase() as AllowedType;
  if (!ALLOWED[input.purpose].includes(type)) {
    throw badRequest(input.contentType.includes("heic") ? "iPhone HEIC photos aren't supported yet. Choose a JPEG." : "That file type isn't supported.", { fields: { contentType: "unsupported" } });
  }
  const max = maxBytesFor(type);
  if (input.size > max) throw badRequest(`That file is too large. The limit is ${max / 1024 / 1024} MB.`, { fields: { size: "too large" } });
  if (!isAdmin) {
    const [today] = await db.select({ n: count() }).from(uploads).where(and(eq(uploads.userId, userId), gte(uploads.createdAt, startOfDayIST(now))));
    if ((today?.n ?? 0) >= config.UPLOADS_PER_DAY) throw tooMany("DAILY_LIMIT", `You've reached ${config.UPLOADS_PER_DAY} uploads today. Try again tomorrow.`);
  }
  const key = `uploads/${userId}/${randomUUID()}.${EXT[type]}`;
  const [row] = await db
    .insert(uploads)
    .values({
      userId,
      purpose: input.purpose,
      storageKey: key,
      contentType: type,
      sizeBytes: input.size,
      originalName: input.filename.slice(0, 200),
      expiresAt: new Date(now.getTime() + PUT_TTL_SECONDS * 1000),
      createdAt: now,
    })
    .returning({ id: uploads.id });
  const put = await deps.storage.presignPut(key, type, input.size, PUT_TTL_SECONDS);
  return { uploadId: row!.id, method: "PUT" as const, url: put.url, headers: put.headers, expiresInSeconds: PUT_TTL_SECONDS };
}

/*
 * Attach an uploaded file to something. Checks, in order: the upload is the caller's, for this purpose and unused;
 * the file exists at the declared size; its first bytes match the declared type. Photos are then re-encoded to drop
 * EXIF metadata (including GPS location), and any faces are pixelated, before anyone else can see them. The result
 * carries a fingerprint so a reused photo or PDF can be recognised (see fingerprints.ts).
 */
export async function consumeUpload(deps: Deps, input: { uploadId: string; userId: string; purpose: Purpose }) {
  const { db, storage } = deps;
  const now = deps.now();
  const [u] = await db
    .update(uploads)
    .set({ consumedAt: now })
    .where(and(eq(uploads.id, input.uploadId), eq(uploads.userId, input.userId), eq(uploads.purpose, input.purpose), isNull(uploads.consumedAt), gte(uploads.createdAt, new Date(now.getTime() - CLAIM_WITHIN_MS))))
    .returning();
  if (!u) throw conflict("UPLOAD_UNAVAILABLE", "That upload can't be used. Upload the file again.");

  const head = await storage.head(u.storageKey);
  if (!head) throw badRequest("The file didn't finish uploading. Upload it again.", { code: "UPLOAD_MISSING" });
  if (head.size !== u.sizeBytes || head.size > maxBytesFor(u.contentType as AllowedType)) throw badRequest("The uploaded file doesn't match what was declared.", { code: "UPLOAD_MISMATCH" });
  const body = await storage.get(u.storageKey);
  const real = body ? sniff(body) : null;
  if (!body || real !== u.contentType) {
    await storage.delete(u.storageKey);
    throw badRequest("That file isn't a valid photo, video or PDF.", { code: "UPLOAD_BAD_TYPE" });
  }
  let size = u.sizeBytes;
  let facesBlurred = 0;
  let hash: bigint | null = null;
  let stored = body;
  if (isImage(real)) {
    let clean: Buffer;
    try {
      clean = await sanitizeImage(body, real);
      hash = await dhash(clean);
    } catch {
      await storage.delete(u.storageKey);
      throw badRequest("That photo couldn't be read. Try another.", { code: "UPLOAD_BAD_IMAGE" });
    }
    /* no face goes on the server unblurred: if the check can't run, the photo isn't taken, and can be sent again */
    let faces;
    try {
      faces = await deps.faces.detect(clean);
    } catch {
      await db.update(uploads).set({ consumedAt: null }).where(eq(uploads.id, u.id));
      throw new HttpError(503, "FACE_CHECK_FAILED", "We couldn't check this photo for faces just now. Try again in a minute.");
    }
    if (faces.length) clean = await blurFaces(clean, faces, real);
    facesBlurred = faces.length;
    await storage.put(u.storageKey, clean, real);
    size = clean.length;
    stored = clean;
  }
  const kind = isImage(real) ? ("photo" as const) : real.startsWith("video/") ? ("video" as const) : ("document" as const);
  const fingerprint = { dhash: hash, sha256: createHash("sha256").update(stored).digest("hex") };
  return { storageKey: u.storageKey, contentType: real, sizeBytes: size, originalName: u.originalName, kind, facesBlurred, fingerprint };
}
