import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

/* development and tests: files live in memory and move through /api/dev/storage (see dev-routes.ts) */
export interface MemoryStorage extends Storage {
  readonly files: Map<string, { body: Buffer; contentType: string }>;
  verify(method: "GET" | "PUT", key: string, exp: string, sig: string, size?: string): boolean;
}

export function memoryStorage(now: () => Date = () => new Date()): MemoryStorage {
  const files = new Map<string, { body: Buffer; contentType: string }>();
  const secret = randomToken();
  const sign = (method: string, key: string, exp: number, size = "") => hmac(secret, `${method}\n${key}\n${exp}\n${size}`);
  const url = (method: "GET" | "PUT", key: string, ttl: number, size?: number) => {
    const exp = Math.floor(now().getTime() / 1000) + ttl;
    const q = new URLSearchParams({ exp: String(exp), sig: sign(method, key, exp, size != null ? String(size) : "") });
    if (size != null) q.set("size", String(size));
    return `/api/dev/storage/${encodeURIComponent(key)}?${q}`;
  };
  return {
    files,
    verify(method, key, exp, sig, size = "") {
      return Number(exp) * 1000 > now().getTime() && sign(method, key, Number(exp), size) === sig;
    },
    async presignPut(key, contentType, size, ttl) {
      return { url: url("PUT", key, ttl, size), headers: { "content-type": contentType } };
    },
    async head(key) {
      const f = files.get(key);
      return f ? { size: f.body.length } : null;
    },
    async get(key) {
      return files.get(key)?.body ?? null;
    },
    async put(key, body, contentType) {
      files.set(key, { body, contentType });
    },
    async signedGetUrl(key, ttl) {
      return url("GET", key, ttl);
    },
    async delete(key) {
      files.delete(key);
    },
  };
}
