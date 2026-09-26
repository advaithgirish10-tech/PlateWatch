export const reportRef = (id: number) => `PW-${4100 + id}`;

/* an accepted report stays on the restaurant's public profile for 2 weeks after it was made */
export const PUBLIC_REPORT_DAYS = 14;
export const publicUntil = (createdAt: Date) => new Date(createdAt.getTime() + PUBLIC_REPORT_DAYS * 86_400_000);

export const STAGES = ["Awaiting moderation", "Accepted", "Restaurant notified", "Sent to FDA Maharashtra", "Official action taken"] as const;

/* where a report is, as the reporter sees it (stage() in bot.js); -1 means it couldn't be used */
export function stageOf(r: { status: string; notifiedAt: Date | null; sentToRegulatorOn: string | null; officialActionOn: string | null }) {
  if (r.status === "rejected") return -1;
  if (r.status !== "accepted") return 0;
  return r.officialActionOn ? 4 : r.sentToRegulatorOn ? 3 : r.notifiedAt ? 2 : 1;
}

export const REPORT_CATEGORIES = ["Pests", "Stale or spoiled food", "Hygiene", "Fell ill", "Other"] as const;
