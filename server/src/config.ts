import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(3000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().url(),
    /* the database's CA certificate (PEM), for providers with their own CA: DigitalOcean (${db.CA_CERT}), Supabase. Not needed for public CAs (Neon) */
    DATABASE_CA_CERT: z.string().default(""),
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
    OTP_PEPPER: z.string().min(16),
    OTP_CHANNEL: z.enum(["console", "whatsapp", "sms", "whatsapp+sms"]).default("console"),
    OTP_DEV_ECHO: bool,
    WHATSAPP_TOKEN: z.string().default(""),
    WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
    WHATSAPP_OTP_TEMPLATE: z.string().default("platewatch_login_code"),
    WHATSAPP_TEMPLATE_LANG: z.string().default("en"),
    WHATSAPP_API_VERSION: z.string().default("v23.0"),
    MSG91_AUTH_KEY: z.string().default(""),
    MSG91_OTP_TEMPLATE_ID: z.string().default(""),
    STORAGE: z.enum(["memory", "s3"]).default("memory"),
    S3_ENDPOINT: z.string().default(""),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().default("platewatch"),
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    S3_FORCE_PATH_STYLE: bool,
    CONSENT_VERSION: z.string().default("2026-09-v1"),
    /* approved kitchen photos on public profiles; keep off until faces are blurred server-side */
    PUBLIC_GALLERY: bool,
    REPORTS_PER_DAY: z.coerce.number().int().positive().default(5),
    UPLOADS_PER_DAY: z.coerce.number().int().positive().default(60),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== "production") return;
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (c.OTP_DEV_ECHO) bad("OTP_DEV_ECHO", "must be false in production");
    if (c.OTP_CHANNEL === "console") bad("OTP_CHANNEL", "console can't send real codes");
    if (c.STORAGE === "memory") bad("STORAGE", "memory storage loses files on restart");
    if (c.OTP_PEPPER.startsWith("dev-")) bad("OTP_PEPPER", "set a real secret");
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
