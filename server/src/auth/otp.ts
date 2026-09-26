import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { otpChallenges, users } from "../db/schema.js";
import { hmac, safeEqualHex, sixDigitCode } from "../lib/crypto.js";
import { HttpError, badRequest, tooMany } from "../lib/errors.js";
import { normalizeIndianMobile } from "../lib/phone.js";
import type { Deps } from "../types.js";

/* the rules the login screen already shows: 6 digits, 3 wrong tries, resend after 30 seconds */
export const OTP_RULES = {
  ttlMs: 10 * 60_000,
  resendMs: 30_000,
  maxAttempts: 3,
  perPhonePerHour: 5,
  perIpPerHour: 20,
};

const HOUR = 3_600_000;

function phoneOrThrow(input: string) {
  const phone = normalizeIndianMobile(input);
  if (!phone) throw badRequest("Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.", { fields: { phone: "invalid" } });
  return phone;
}

const codeHash = (deps: Deps, phone: string, code: string) => hmac(deps.config.OTP_PEPPER, `${phone}:${code}`);

export async function requestOtp(deps: Deps, input: { phone: string; ip: string }) {
  const { db } = deps;
  const now = deps.now();
  const phone = phoneOrThrow(input.phone);

  const [last] = await db
    .select({ createdAt: otpChallenges.createdAt })
    .from(otpChallenges)
    .where(eq(otpChallenges.phone, phone))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);
  if (last && now.getTime() - last.createdAt.getTime() < OTP_RULES.resendMs) {
    const wait = Math.ceil((OTP_RULES.resendMs - (now.getTime() - last.createdAt.getTime())) / 1000);
    throw tooMany("RESEND_TOO_SOON", `Wait ${wait} seconds before asking for a new code.`, wait);
  }
  const hourAgo = new Date(now.getTime() - HOUR);
  const [byPhone] = await db.select({ n: count() }).from(otpChallenges).where(and(eq(otpChallenges.phone, phone), gt(otpChallenges.createdAt, hourAgo)));
  if ((byPhone?.n ?? 0) >= OTP_RULES.perPhonePerHour) throw tooMany("TOO_MANY_CODES", "Too many codes for this number. Try again in an hour.", 3600);
  const [byIp] = await db.select({ n: count() }).from(otpChallenges).where(and(eq(otpChallenges.ip, input.ip), gt(otpChallenges.createdAt, hourAgo)));
  if ((byIp?.n ?? 0) >= OTP_RULES.perIpPerHour) throw tooMany("TOO_MANY_CODES", "Too many codes requested from this network. Try again later.", 3600);

  const code = sixDigitCode();
  /* only the newest code works */
  await db
    .update(otpChallenges)
    .set({ consumedAt: now })
    .where(and(eq(otpChallenges.phone, phone), isNull(otpChallenges.consumedAt)));
  const [ch] = await db
    .insert(otpChallenges)
    .values({ phone, codeHash: codeHash(deps, phone, code), channel: "console", ip: input.ip, expiresAt: new Date(now.getTime() + OTP_RULES.ttlMs), createdAt: now })
    .returning({ id: otpChallenges.id });

  let channel;
  try {
    channel = await deps.otp.send(phone, code);
  } catch {
    await db.update(otpChallenges).set({ consumedAt: now }).where(eq(otpChallenges.id, ch!.id));
    throw new HttpError(502, "SEND_FAILED", "We couldn't send the code. Try again in a minute.");
  }
  await db.update(otpChallenges).set({ channel }).where(eq(otpChallenges.id, ch!.id));

  return {
    channel,
    expiresInSeconds: OTP_RULES.ttlMs / 1000,
    resendInSeconds: OTP_RULES.resendMs / 1000,
    ...(deps.config.OTP_DEV_ECHO ? { devCode: code } : {}),
  };
}

export async function verifyOtp(deps: Deps, input: { phone: string; code: string; consent?: boolean }) {
  const { db, config } = deps;
  const now = deps.now();
  const phone = phoneOrThrow(input.phone);
  const code = input.code.replace(/\D/g, "");

  const [ch] = await db
    .select()
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phone, phone), isNull(otpChallenges.consumedAt), gt(otpChallenges.expiresAt, now)))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);
  if (!ch) throw badRequest("That code has expired. Request a new one.", { code: "CODE_EXPIRED" });

  if (code.length !== 6 || !safeEqualHex(ch.codeHash, codeHash(deps, phone, code))) {
    const [after] = await db
      .update(otpChallenges)
      .set({
        attempts: sql`${otpChallenges.attempts} + 1`,
        consumedAt: sql`case when ${otpChallenges.attempts} + 1 >= ${OTP_RULES.maxAttempts} then ${now.toISOString()}::timestamptz else null end`,
      })
      .where(eq(otpChallenges.id, ch.id))
      .returning({ attempts: otpChallenges.attempts });
    const left = OTP_RULES.maxAttempts - (after?.attempts ?? OTP_RULES.maxAttempts);
    if (left <= 0) throw tooMany("TOO_MANY_ATTEMPTS", "Too many wrong tries. Request a new code.");
    throw badRequest(`That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.`, { code: "WRONG_CODE", triesLeft: left });
  }

  const [existing] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  const needsConsent = !existing || existing.consentVersion !== config.CONSENT_VERSION;
  if (needsConsent && input.consent !== true) {
    throw badRequest("Agree to how PlateWatch uses your number to continue.", { code: "CONSENT_REQUIRED" });
  }

  /* consume the code last, atomically, so a race can't use it twice */
  const claimed = await db
    .update(otpChallenges)
    .set({ consumedAt: now })
    .where(and(eq(otpChallenges.id, ch.id), isNull(otpChallenges.consumedAt)))
    .returning({ id: otpChallenges.id });
  if (!claimed.length) throw badRequest("That code has expired. Request a new one.", { code: "CODE_EXPIRED" });

  const consent = needsConsent ? { consentVersion: config.CONSENT_VERSION, consentedAt: now } : {};
  const [user] = existing
    ? await db.update(users).set({ lastLoginAt: now, ...consent }).where(eq(users.id, existing.id)).returning()
    : await db.insert(users).values({ phone, phoneVerifiedAt: now, lastLoginAt: now, ...consent }).returning();
  return user!;
}
