/*
 * Reused files. Every photo gets a 64-bit difference hash and every file a SHA-256. A new photo within MAX_DISTANCE
 * bits of an earlier one, or a PDF identical to an earlier one, is recorded as a possible reuse: the same kitchen
 * photo sent again for the next evidence cycle, one diner's photo used in two reports, a diner's photo sent back as a
 * restaurant's "proof", or one licence certificate used to claim two restaurants. It's a flag for reviewers, not a
 * block: the same counter photographed from the same spot two weeks apart can look alike.
 * Fingerprints outlive the files (deleted after 4 or 24 months), so an old photo is still recognised.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { evidence, fileFingerprints, reportEvidence, restaurants } from "../../db/schema.js";
import type { Storage } from "../../storage/storage.js";

export const MAX_DISTANCE = 6;
export type Source = "evidence" | "report" | "proof" | "claim";
export interface Fingerprint { dhash: bigint | null; sha256: string }

/* the closest earlier file that looks the same */
async function findMatch(db: Queryable, fp: Fingerprint, before: number) {
  if (fp.dhash != null) {
    const dist = sql<number>`bit_count((${fileFingerprints.dhash} # ${fp.dhash}::bigint)::bit(64))`;
    const [m] = await db
      .select({ id: fileFingerprints.id, distance: dist })
      .from(fileFingerprints)
      .where(and(sql`${fileFingerprints.dhash} is not null`, sql`${fileFingerprints.id} < ${before}`, sql`${dist} <= ${MAX_DISTANCE}`))
      .orderBy(dist, fileFingerprints.id)
      .limit(1);
    return m ? { id: m.id, distance: Number(m.distance) } : null;
  }
  const [m] = await db
    .select({ id: fileFingerprints.id })
    .from(fileFingerprints)
    .where(and(eq(fileFingerprints.sha256, fp.sha256), isNull(fileFingerprints.dhash), sql`${fileFingerprints.id} < ${before}`))
    .orderBy(fileFingerprints.id)
    .limit(1);
  return m ? { id: m.id, distance: 0 } : null;
}

/* store a file's fingerprint; returns the earlier file it matches, if any */
export async function recordFingerprint(
  db: Queryable,
  f: { source: Source; sourceId: string | number; restaurantId: number | null; userId: string | null; storageKey: string; fingerprint: Fingerprint },
) {
  const [row] = await db
    .insert(fileFingerprints)
    .values({ source: f.source, sourceId: String(f.sourceId), restaurantId: f.restaurantId, userId: f.userId, storageKey: f.storageKey, dhash: f.fingerprint.dhash, sha256: f.fingerprint.sha256 })
    .returning({ id: fileFingerprints.id });
  const match = await findMatch(db, f.fingerprint, row!.id);
  if (match) await db.update(fileFingerprints).set({ matchOf: match.id, matchDistance: match.distance }).where(eq(fileFingerprints.id, row!.id));
  return match;
}

export interface Reuse {
  /* what the earlier file was */
  source: Source;
  label: string;
  date: string;
  restaurant: string | null;
  /* identical file, or a photo that looks the same */
  exact: boolean;
  distance: number;
  /* the earlier file, while it's still kept */
  url: string;
}

/* for a set of files (by source and ID), the earlier file each one seems to reuse */
export async function reuseFor(db: Queryable, storage: Storage, source: Source, sourceIds: (string | number)[]): Promise<Map<string, Reuse>> {
  const out = new Map<string, Reuse>();
  if (!sourceIds.length) return out;
  const mine = await db
    .select()
    .from(fileFingerprints)
    .where(and(eq(fileFingerprints.source, source), inArray(fileFingerprints.sourceId, sourceIds.map(String)), sql`${fileFingerprints.matchOf} is not null`))
    .orderBy(desc(fileFingerprints.id));
  if (!mine.length) return out;
  const earlier = await db
    .select({ f: fileFingerprints, name: restaurants.name })
    .from(fileFingerprints)
    .leftJoin(restaurants, eq(restaurants.id, fileFingerprints.restaurantId))
    .where(inArray(fileFingerprints.id, [...new Set(mine.map((m) => m.matchOf!))]));
  for (const m of mine) {
    if (out.has(m.sourceId)) continue; /* the newest file for this item */
    const e = earlier.find((x) => x.f.id === m.matchOf);
    if (!e) continue;
    out.set(m.sourceId, {
      source: e.f.source,
      label: await labelOf(db, e.f.source, e.f.sourceId),
      date: e.f.createdAt.toISOString(),
      restaurant: e.name,
      exact: e.f.dhash == null || m.matchDistance === 0,
      distance: m.matchDistance ?? 0,
      url: await storage.signedGetUrl(e.f.storageKey, 900),
    });
  }
  return out;
}

async function labelOf(db: Queryable, source: Source, id: string) {
  if (source === "claim") return `a restaurant claim (#${id})`;
  if (source === "proof") return `a restaurant's proof on report PW-${4100 + Number(id)}`;
  if (source === "report") {
    const [r] = await db.select({ reportId: reportEvidence.reportId }).from(reportEvidence).where(eq(reportEvidence.id, id)).limit(1);
    return r ? `a diner's report (PW-${4100 + r.reportId})` : "a diner's report";
  }
  const [e] = await db.select({ req: evidence.requirementId }).from(evidence).where(eq(evidence.id, id)).limit(1);
  return e ? `checkup evidence (${e.req})` : "checkup evidence (since removed)";
}

