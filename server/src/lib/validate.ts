import { z } from "zod";
import { badRequest } from "./errors.js";

/* parse request input; unknown fields are stripped, failures become a 400 with per-field messages */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw badRequest("Check the highlighted fields.", { fields });
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const uuidParam = z.object({ id: z.uuid() });
/* trimmed text with a length cap; control characters removed */
export const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(max));
