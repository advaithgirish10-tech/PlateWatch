/* Indian mobile numbers only: 10 digits starting 6–9, with an optional +91, 91 or 0 prefix. Returns E.164 or null. */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/* +91 98765 43210, the way the site prints numbers */
export function displayPhone(e164: string): string {
  const local = e164.replace(/^\+91/, "");
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
