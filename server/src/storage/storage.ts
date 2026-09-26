import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Config } from "../config.js";
import { hmac, randomToken } from "../lib/crypto.js";

export interface Storage {
  /* a URL the browser PUTs the file to; the signature pins the content type and exact size */
  presignPut(key: string, contentType: string, size: number, ttlSeconds: number): Promise<{ url: string; headers: Record<string, string> }>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  signedGetUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

/* Cloudflare R2, Amazon S3, or SeaweedFS locally */
export function s3Storage(c: Config): Storage {
  const client = new S3Client({
    region: c.S3_REGION,
    endpoint: c.S3_ENDPOINT || undefined,
    forcePathStyle: c.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY },
    /* R2 and other S3-compatible stores reject the SDK's default checksum headers on presigned uploads */
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = c.S3_BUCKET;
  const isMissing = (e: unknown) =>
    (e as { name?: string }).name === "NotFound" ||
    (e as { name?: string }).name === "NoSuchKey" ||
    (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
  return {
    async presignPut(key, contentType, size, ttl) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: size }), {
        expiresIn: ttl,
        signableHeaders: new Set(["content-type", "content-length"]),
      });
      return { url, headers: { "content-type": contentType } };
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: r.ContentLength ?? 0 };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async get(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    signedGetUrl(key, ttl) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttl });
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

/* development and tests: files move through /api/dev/storage (see dev-routes.ts), with the same signed-URL rules as S3 */
export interface DevStorage extends Storage {
  verify(method: "GET" | "PUT", key: string, exp: string, sig: string, size?: string): boolean;
  read(key: string): Promise<{ body: Buffer; contentType: string } | null>;
}
export interface MemoryStorage extends DevStorage {
  readonly files: Map<string, { body: Buffer; contentType: string }>;
}

interface Backend {
  read(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  write(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/* tests: files are kept in memory and lost when the process ends */
export function memoryStorage(now: () => Date = () => new Date()): MemoryStorage {
  const files = new Map<string, { body: Buffer; contentType: string }>();
  const s = devStorage(
    {
      read: async (key) => files.get(key) ?? null,
      write: async (key, body, contentType) => void files.set(key, { body, contentType }),
      remove: async (key) => void files.delete(key),
    },
    randomToken(),
    now,
  );
  return { ...s, files };
}

/* development: files are kept in a folder (server/.data/uploads), so they survive restarts. Links are signed with a
   key derived from OTP_PEPPER, so a link made before a restart still works after it */
export function localStorage(dir: string, secret: string, now: () => Date = () => new Date()): DevStorage {
  const root = resolve(dir);
  const pathOf = (key: string) => {
    const p = resolve(root, key);
    if (!p.startsWith(root + sep)) throw new Error("bad storage key");
    return p;
  };
  return devStorage(
    {
      async read(key) {
        try {
          const p = pathOf(key);
          return { body: await readFile(p), contentType: (await readFile(p + ".type", "utf8").catch(() => "")) || "application/octet-stream" };
        } catch {
          return null;
        }
      },
      async write(key, body, contentType) {
        const p = pathOf(key);
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, body);
        await writeFile(p + ".type", contentType);
      },
      async remove(key) {
        const p = pathOf(key);
        await rm(p, { force: true });
        await rm(p + ".type", { force: true });
      },
    },
    hmac(secret, "platewatch-local-storage"),
    now,
  );
}

function devStorage(files: Backend, secret: string, now: () => Date): DevStorage {
  const sign = (method: string, key: string, exp: number, size = "") => hmac(secret, `${method}\n${key}\n${exp}\n${size}`);
  const url = (method: "GET" | "PUT", key: string, ttl: number, size?: number) => {
    const exp = Math.floor(now().getTime() / 1000) + ttl;
    const q = new URLSearchParams({ exp: String(exp), sig: sign(method, key, exp, size != null ? String(size) : "") });
    if (size != null) q.set("size", String(size));
    return `/api/dev/storage/${encodeURIComponent(key)}?${q}`;
  };
  return {
    verify(method, key, exp, sig, size = "") {
      return Number(exp) * 1000 > now().getTime() && sign(method, key, Number(exp), size) === sig;
    },
    read: (key) => files.read(key),
    async presignPut(key, contentType, size, ttl) {
      return { url: url("PUT", key, ttl, size), headers: { "content-type": contentType } };
    },
    async head(key) {
      const f = await files.read(key);
      return f ? { size: f.body.length } : null;
    },
    async get(key) {
      return (await files.read(key))?.body ?? null;
    },
    async put(key, body, contentType) {
      await files.write(key, body, contentType);
    },
    async signedGetUrl(key, ttl) {
      return url("GET", key, ttl);
    },
    async delete(key) {
      await files.remove(key);
    },
  };
}

export function storageFromConfig(c: Config): Storage {
  if (c.STORAGE === "s3") return s3Storage(c);
  if (c.STORAGE === "local") return localStorage(c.LOCAL_STORAGE_DIR, c.OTP_PEPPER);
  return memoryStorage();
}
