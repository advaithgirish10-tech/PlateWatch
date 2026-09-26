export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Sign in to continue.") => new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You don't have access to this.") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found.") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const tooMany = (code: string, message: string, retryAfterSeconds?: number) =>
  new HttpError(429, code, message, retryAfterSeconds != null ? { retryAfterSeconds } : undefined);
