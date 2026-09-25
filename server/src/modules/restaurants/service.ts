import { desc, eq, sql } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { enforcementActions, restaurants } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";

export type ActionType = "sus" | "rev" | "imp" | "ok";
export type Dot = "red" | "amber" | "green" | "grey";

export const DOT: Record<ActionType, Dot> = { sus: "red", rev: "red", imp: "amber", ok: "green" };
export const dotOf = (status: ActionType | null): Dot => (status ? DOT[status] : "grey");
/* while one of these is the latest action, the compliance score is not shown publicly */
export const isOpenAction = (status: ActionType | null) => status === "sus" || status === "rev" || status === "imp";

const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const PRIOR: Record<string, string> = { sus: "a suspension", rev: "a revocation", imp: "an improvement notice" };

/* one plain sentence from the latest official action, no verdicts (summaryLine in the prototype) */
export function summaryLine(history: { actionOn: string; type: ActionType; authority: string }[], lastVerifiedOn: string) {
  const c = history.at(-1);
  if (!c) return `No official action on record as of ${fmt(lastVerifiedOn)}. This is not a guarantee of hygiene.`;
  if (c.type === "sus") return `Licence suspended by ${c.authority} on ${fmt(c.actionOn)}. Not reinstated as of ${fmt(lastVerifiedOn)}.`;
  if (c.type === "rev") return `Licence revoked by ${c.authority} on ${fmt(c.actionOn)}.`;
  if (c.type === "imp") return `Improvement notice issued on ${fmt(c.actionOn)}. Follow-up pending.`;
  const pv = history.at(-2);
  return pv ? `Licence reinstated on ${fmt(c.actionOn)} after ${PRIOR[pv.type] ?? "an earlier action"} on ${fmt(pv.actionOn)}.` : `Licence reinstated on ${fmt(c.actionOn)}.`;
}

/* record an official action and move the restaurant's current status with it, in one transaction */
export async function addEnforcementAction(
  tx: Queryable,
  a: { restaurantId: number; actionOn: string; type: ActionType; summary: string; authority?: string; sourceUrl?: string | null; actorId: string | null },
) {
  const [row] = await tx
    .insert(enforcementActions)
    .values({ restaurantId: a.restaurantId, actionOn: a.actionOn, type: a.type, summary: a.summary, authority: a.authority, sourceUrl: a.sourceUrl ?? null, createdBy: a.actorId })
    .returning();
  const [latest] = await tx
    .select({ type: enforcementActions.type, actionOn: enforcementActions.actionOn })
    .from(enforcementActions)
    .where(eq(enforcementActions.restaurantId, a.restaurantId))
    .orderBy(desc(enforcementActions.actionOn), desc(enforcementActions.id))
    .limit(1);
  await tx
    .update(restaurants)
    .set({ currentStatus: latest!.type, currentStatusOn: latest!.actionOn, lastVerifiedOn: sql`greatest(${restaurants.lastVerifiedOn}, ${a.actionOn}::date)`, updatedAt: new Date() })
    .where(eq(restaurants.id, a.restaurantId));
  await audit(tx, { actorId: a.actorId, action: "enforcement.add", entityType: "restaurant", entityId: a.restaurantId, data: { actionId: row!.id, type: a.type, actionOn: a.actionOn } });
  return row!;
}

/* escape LIKE wildcards in user input */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
