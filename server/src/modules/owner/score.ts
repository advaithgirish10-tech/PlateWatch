/*
 * The compliance score and the PlateWatch badge, ported from the prototype (scoreOf in platewatch.js, verif in map.js).
 * Score = weighted requirements met ÷ weighted applicable × 100. A requirement is met when it's answered "yes"
 * and has current, non-rejected evidence. The badge needs current evidence that a reviewer approved.
 */
import { daysBetween } from "../../lib/dates.js";

export type Answer = "yes" | "no" | "na";
export type EvidenceStatus = "submitted" | "more" | "verified" | "rejected";
export interface Category { key: string; name: string; expiryDays: number }
export interface Requirement { id: string; categoryKey: string; text: string; weight: number; critical: boolean }
export interface EvidenceLite { requirementId: string; status: EvidenceStatus; capturedOn: string; kind?: string }
export type Why = "Not answered" | "Answered no" | "Evidence expired" | "Evidence needed";

export interface Checkup {
  cats: Map<string, Category>;
  reqs: Requirement[];
  answers: Map<string, Answer>;
  evidence: EvidenceLite[];
  today: string;
}

const current = (e: EvidenceLite, cat: Category, today: string) => e.status !== "rejected" && daysBetween(e.capturedOn, today) <= cat.expiryDays;

export function score({ cats, reqs, answers, evidence, today }: Checkup) {
  let W = 0, E = 0, done = 0, tot = 0, unanswered = 0;
  const byCat = new Map<string, { W: number; E: number; done: number; tot: number }>();
  for (const c of cats.values()) byCat.set(c.key, { W: 0, E: 0, done: 0, tot: 0 });
  const critical: Requirement[] = [];
  const missing: { requirement: Requirement; why: Why }[] = [];
  for (const r of reqs) {
    const a = answers.get(r.id);
    if (a === "na") continue;
    const cat = cats.get(r.categoryKey)!;
    const bc = byCat.get(r.categoryKey)!;
    tot++; W += r.weight; bc.W += r.weight; bc.tot++;
    if (!a) unanswered++;
    const evs = evidence.filter((e) => e.requirementId === r.id);
    if (a === "yes" && evs.some((e) => current(e, cat, today))) {
      done++; E += r.weight; bc.E += r.weight; bc.done++;
      continue;
    }
    const why: Why = !a ? "Not answered" : a === "no" ? "Answered no" : evs.some((e) => e.status !== "rejected") ? "Evidence expired" : "Evidence needed";
    missing.push({ requirement: r, why });
    if (r.critical) critical.push(r);
  }
  const categories = [...cats.values()].map((c) => {
    const x = byCat.get(c.key)!;
    return { key: c.key, name: c.name, done: x.done, total: x.tot, percent: x.W ? Math.round((x.E / x.W) * 100) : null };
  });
  return { overall: W ? Math.round((E / W) * 100) : 0, done, total: tot, unanswered, categories, critical, missing };
}

export const grade = (s: number) => (s >= 90 ? "Strong" : s >= 75 ? "Good" : s >= 60 ? "Needs work" : "Incomplete");

/* per category: fresh (under half its validity used), aging, expired items, or no evidence */
export function freshness({ cats, reqs, answers, evidence, today }: Checkup) {
  return [...cats.values()].map((c) => {
    const inCat = reqs.filter((r) => r.categoryKey === c.key);
    const live = evidence.filter((e) => e.status !== "rejected" && inCat.some((r) => r.id === e.requirementId));
    if (!live.length) return { key: c.key, name: c.name, state: "none" as const, lastUpdated: null };
    const lastUpdated = live.map((e) => e.capturedOn).sort().at(-1)!;
    const expired = inCat.filter((r) => answers.get(r.id) === "yes" && live.some((e) => e.requirementId === r.id) && !live.some((e) => e.requirementId === r.id && current(e, c, today))).length;
    if (expired) return { key: c.key, name: c.name, state: "expired" as const, lastUpdated, expiredItems: expired };
    return { key: c.key, name: c.name, state: daysBetween(lastUpdated, today) <= c.expiryDays / 2 ? ("fresh" as const) : ("aging" as const), lastUpdated };
  });
}

export type BadgeLevel = "none" | "claimed" | "verified";

/* "PlateWatch verified" needs every applicable requirement backed by current, approved evidence and nothing waiting for review.
   Official actions never change the badge. (Spot-check pauses arrive with the spot-check module.) */
export function badge(ownerLevel: "self" | "pending" | "platform" | null, c: Checkup): { level: BadgeLevel; paused?: string[] } {
  if (!ownerLevel) return { level: "none" };
  if (ownerLevel !== "platform") return { level: "claimed" };
  const why: string[] = [];
  if (c.evidence.some((e) => e.status === "submitted" || e.status === "more")) why.push("new evidence waiting for review");
  const unmet = c.reqs.filter((r) => {
    if (c.answers.get(r.id) === "na") return false;
    const cat = c.cats.get(r.categoryKey)!;
    return !(c.answers.get(r.id) === "yes" && c.evidence.some((e) => e.requirementId === r.id && e.status === "verified" && daysBetween(e.capturedOn, c.today) <= cat.expiryDays));
  }).length;
  if (unmet) why.push(`${unmet} requirement${unmet === 1 ? "" : "s"} without current approved evidence`);
  return why.length ? { level: "claimed", paused: why } : { level: "verified" };
}
