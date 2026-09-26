import type { Config } from "./config.js";
import type { DB } from "./db/client.js";
import type { OtpSender } from "./messaging/otp-sender.js";
import type { Storage } from "./storage/storage.js";

export interface Deps {
  config: Config;
  db: DB;
  storage: Storage;
  otp: OtpSender;
  /* injectable clock, so tests can move time forward */
  now: () => Date;
}

export interface SessionUser {
  id: string;
  phone: string;
  name: string | null;
  role: "user" | "admin";
  whatsappAlerts: boolean;
  phoneVerifiedAt: Date;
  sessionId: string;
  /* which login this request came from: the diner's or the restaurant owner's */
  mode: SessionMode;
}

export type SessionMode = "user" | "owner";

declare module "fastify" {
  interface FastifyInstance {
    deps: Deps;
  }
  interface FastifyRequest {
    user: SessionUser | null;
  }
}
