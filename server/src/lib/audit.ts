import type { Queryable } from "../db/client.js";
import { auditLog } from "../db/schema.js";

export async function audit(
  db: Queryable,
  entry: { actorId: string | null; action: string; entityType: string; entityId: string | number; data?: Record<string, unknown> },
) {
  await db.insert(auditLog).values({ ...entry, entityId: String(entry.entityId) });
}
