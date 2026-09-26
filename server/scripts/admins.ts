/*
 * Who can use the admin tools. Run on the server (or its console), never exposed over the API:
 *   npm run admin:list
 *   npm run admin:grant -- 98765xxxxx    (the person must have signed in once with that number)
 *   npm run admin:revoke -- 98765xxxxx   (also signs them out everywhere, effective immediately)
 */
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import { sessions, users } from "../src/db/schema.js";
import { audit } from "../src/lib/audit.js";
import { displayPhone, normalizeIndianMobile } from "../src/lib/phone.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const [command, arg = ""] = process.argv.slice(2);
const { db, pool } = createDb(url, 1);

try {
  if (command === "list") {
    const rows = await db.select({ phone: users.phone, name: users.name, since: users.createdAt }).from(users).where(eq(users.role, "admin"));
    console.log(rows.length ? rows.map((r) => `${displayPhone(r.phone)}${r.name ? `  ${r.name}` : ""}`).join("\n") : "No admins yet.");
  } else if (command === "grant" || command === "revoke") {
    const phone = normalizeIndianMobile(arg);
    if (!phone) throw new Error(`Usage: npm run admin:${command} -- <10-digit mobile number>`);
    const role = command === "grant" ? "admin" : "user";
    const u = await db.transaction(async (tx) => {
      const [row] = await tx.update(users).set({ role }).where(eq(users.phone, phone)).returning({ id: users.id });
      if (!row) return null;
      if (command === "revoke") await tx.delete(sessions).where(eq(sessions.userId, row.id));
      await audit(tx, { actorId: null, action: `user.${command}_admin`, entityType: "user", entityId: row.id });
      return row;
    });
    if (!u) {
      console.log(`No account for ${displayPhone(phone)}. Sign in once with that number first.`);
      process.exitCode = 1;
    } else console.log(command === "grant" ? `${displayPhone(phone)} is now an admin.` : `${displayPhone(phone)} is no longer an admin and has been signed out.`);
  } else {
    throw new Error("Usage: npm run admin:list | admin:grant -- <number> | admin:revoke -- <number>");
  }
} finally {
  await pool.end();
}
