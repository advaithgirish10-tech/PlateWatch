/*
 * PlateWatch API client. The API answers /api on the same origin as the site
 * (Vite proxies it to server/ in development). Every failure becomes an ApiError
 * with a plain sentence the page can show as-is.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || {};
  }
}

const OFFLINE = "Can't reach PlateWatch right now. Check your connection and try again.";

export async function api(method, path, body, { timeout = 15000 } = {}) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (_) {
    throw new ApiError(0, "NETWORK", OFFLINE);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (_) { /* not JSON: a proxy or server error page */ }
  if (res.ok && data) return data;
  /* no JSON error body means the API itself didn't answer (down, or a proxy error) */
  if (!data || !data.error) throw new ApiError(res.status, "NETWORK", OFFLINE);
  throw new ApiError(res.status, data.error, data.message, { ...data.details });
}

/* the API speaks E.164 (+919876543210); the site keeps the 10-digit local number */
export const localPhone = e164 => String(e164 || "").replace(/^\+91/, "");

/* send a file the way the API expects: ask for a signed URL, PUT the bytes to storage, return the upload's ID */
export async function uploadFile(file, purpose) {
  const up = await api("POST", "/uploads", { purpose, contentType: file.type || "application/octet-stream", size: file.size, filename: file.name || "file" });
  let res;
  try {
    res = await fetch(up.url, { method: "PUT", headers: up.headers, body: file });
  } catch (_) {
    throw new ApiError(0, "NETWORK", "The upload didn't go through. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError(res.status, "UPLOAD_FAILED", "The upload didn't go through. Try again.");
  return up.uploadId;
}
