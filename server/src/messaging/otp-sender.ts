import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";

export type OtpChannel = "console" | "whatsapp" | "sms";

export interface OtpSender {
  /* sends the code and returns the channel that delivered it; throws if nothing could */
  send(phoneE164: string, code: string): Promise<OtpChannel>;
}

const TIMEOUT_MS = 10_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/* development: the code goes to the server log */
export function consoleSender(log: FastifyBaseLogger): OtpSender {
  return {
    async send(phone, code) {
      log.info({ phone }, `OTP for ${phone}: ${code}`);
      return "console";
    },
  };
}

/* WhatsApp Cloud API, authentication template with a copy-code button */
export function whatsappSender(c: Config): OtpSender {
  return {
    async send(phone, code) {
      await postJson(
        `https://graph.facebook.com/${c.WHATSAPP_API_VERSION}/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        { authorization: `Bearer ${c.WHATSAPP_TOKEN}` },
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone.replace(/^\+/, ""),
          type: "template",
          template: {
            name: c.WHATSAPP_OTP_TEMPLATE,
            language: { code: c.WHATSAPP_TEMPLATE_LANG },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
            ],
          },
        },
      );
      return "whatsapp";
    },
  };
}

/* MSG91 OTP API with our own code, sent on a DLT-approved template */
export function msg91Sender(c: Config): OtpSender {
  return {
    async send(phone, code) {
      const q = new URLSearchParams({ template_id: c.MSG91_OTP_TEMPLATE_ID, mobile: phone.replace(/^\+/, ""), otp: code });
      await postJson(`https://control.msg91.com/api/v5/otp?${q}`, { authkey: c.MSG91_AUTH_KEY }, {});
      return "sms";
    },
  };
}

/* try each sender in turn; the first success wins */
export function withFallback(log: FastifyBaseLogger, ...senders: OtpSender[]): OtpSender {
  return {
    async send(phone, code) {
      let last: unknown;
      for (const s of senders) {
        try {
          return await s.send(phone, code);
        } catch (err) {
          last = err;
          log.warn({ err }, "OTP sender failed, trying the next one");
        }
      }
      throw last ?? new Error("No OTP sender configured");
    },
  };
}

export function otpSenderFromConfig(c: Config, log: FastifyBaseLogger): OtpSender {
  switch (c.OTP_CHANNEL) {
    case "console":
      return consoleSender(log);
    case "whatsapp":
      return whatsappSender(c);
    case "sms":
      return msg91Sender(c);
    case "whatsapp+sms":
      return withFallback(log, whatsappSender(c), msg91Sender(c));
  }
}
