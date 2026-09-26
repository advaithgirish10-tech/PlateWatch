/*
 * How long checkup files are kept. Kitchen photos (and videos) are deleted 4 months after upload: every photo
 * category needs new photos within a month, so by then they count for nothing. PDFs (pest control contracts,
 * licences, certificates) are kept for 2 years. The database row and the stored file go together.
 */
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { evidence } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import type { Deps } from "../types.js";

export const RETENTION = { imageMonths: 4, documentMonths: 24 };
const BATCH = 500;

const monthsBefore = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() - n);
  return x;
};

export async function purgeOldEvidence(deps: Deps) {
  const { db, storage } = deps;
  const now = deps.now();
  const imagesBefore = monthsBefore(now, RETENTION.imageMonths);
  const documentsBefore = monthsBefore(now, RETENTION.documentMonths);
  const removed = { images: 0, documents: 0 };
  for (;;) {
    const rows = await db
      .select({ id: evidence.id, key: evidence.storageKey, kind: evidence.kind })
      .from(evidence)
      .where(
        or(
          and(inArray(evidence.kind, ["photo", "video"]), lt(evidence.createdAt, imagesBefore)),
          and(eq(evidence.kind, "document"), lt(evidence.createdAt, documentsBefore)),
        ),
      )
      .limit(BATCH);
    if (!rows.length) break;
    /* the file first: a failed delete leaves the row, so the next run tries again */
    const gone: string[] = [];
    for (const r of rows) {
      try {
        await storage.delete(r.key);
        gone.push(r.id);
        r.kind === "document" ? removed.documents++ : removed.images++;
      } catch {
        /* storage unreachable: stop, and retry on the next run */
      }
    }
    if (gone.length) await db.delete(evidence).where(inArray(evidence.id, gone));
    if (gone.length < rows.length || rows.length < BATCH) break;
  }
  if (removed.images || removed.documents) {
    await audit(db, { actorId: null, action: "evidence.purge", entityType: "evidence", entityId: "retention", data: removed });
  }
  return removed;
}

/* run now, then every 6 hours; each run is safe to repeat, so several API instances can run it */
export function scheduleRetention(deps: Deps, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  const run = () =>
    purgeOldEvidence(deps).then(
      (r) => (r.images || r.documents) && log.info(r, "retention: old evidence files deleted"),
      (err) => log.error({ err }, "retention run failed"),
    );
  void run();
  const t = setInterval(run, 6 * 3_600_000);
  t.unref();
  return () => clearInterval(t);
}
