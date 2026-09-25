import { and, asc, inArray, ne } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { evidence, requirementCategories, requirements, responses, restaurantOwners } from "../../db/schema.js";
import { badge, type Answer, type Category, type Checkup, type Requirement } from "./score.js";

export async function loadCatalog(db: Queryable) {
  const catRows = await db.select().from(requirementCategories).orderBy(asc(requirementCategories.sort));
  const reqRows = await db.select().from(requirements).orderBy(asc(requirements.sort));
  const cats = new Map<string, Category>(catRows.map((c) => [c.key, { key: c.key, name: c.name, expiryDays: c.expiryDays }]));
  const reqs: Requirement[] = reqRows.map((r) => ({ id: r.id, categoryKey: r.categoryKey, text: r.text, weight: r.weight, critical: r.critical }));
  return { cats, reqs };
}

export type OwnerLevel = "self" | "pending" | "platform";

/* every checkup for these restaurants in three queries: owners, answers, non-rejected evidence */
export async function loadCheckups(db: Queryable, ids: number[], today: string) {
  const out = new Map<number, { level: OwnerLevel | null; checkup: Checkup }>();
  if (!ids.length) return out;
  const { cats, reqs } = await loadCatalog(db);
  const owners = await db.select().from(restaurantOwners).where(inArray(restaurantOwners.restaurantId, ids));
  const owned = owners.map((o) => o.restaurantId);
  const ans = owned.length ? await db.select().from(responses).where(inArray(responses.restaurantId, owned)) : [];
  const evs = owned.length
    ? await db
        .select({ restaurantId: evidence.restaurantId, requirementId: evidence.requirementId, status: evidence.status, capturedOn: evidence.capturedOn, kind: evidence.kind })
        .from(evidence)
        .where(and(inArray(evidence.restaurantId, owned), ne(evidence.status, "rejected")))
    : [];
  const levelOf = new Map(owners.map((o) => [o.restaurantId, o.level]));
  for (const id of ids) {
    out.set(id, {
      level: levelOf.get(id) ?? null,
      checkup: {
        cats,
        reqs,
        answers: new Map(ans.filter((a) => a.restaurantId === id).map((a) => [a.requirementId, a.answer as Answer])),
        evidence: evs.filter((e) => e.restaurantId === id),
        today,
      },
    });
  }
  return out;
}

export async function badgesFor(db: Queryable, ids: number[], today: string) {
  const all = await loadCheckups(db, ids, today);
  return new Map([...all].map(([id, x]) => [id, badge(x.level, x.checkup)]));
}
