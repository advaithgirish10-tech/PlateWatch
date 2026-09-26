/*
 * Who hears about what. Each function runs inside the transaction that made the change, so a notification exists
 * exactly when the change does.
 */
import { eq, inArray } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { claimRequests, evidence, reports, requirements, restaurantResponses, restaurants } from "../../db/schema.js";
import { reportRef } from "../reports/dto.js";
import { admins, followersOf, notify, ownerOf, snippet, toDiner, type Note } from "./service.js";

const nameOf = async (db: Queryable, id: number | null) =>
  id ? ((await db.select({ name: restaurants.name }).from(restaurants).where(eq(restaurants.id, id)).limit(1))[0]?.name ?? "the restaurant") : null;

/* followers of a restaurant, minus people already told */
async function toFollowers(db: Queryable, restaurantId: number, except: (string | null)[], n: { type: string; title: string; body: string; key: string }) {
  const list = await followersOf(db, restaurantId, except);
  await notify(db, list.map((f) => ({ ...n, userId: f.id, audience: "user" as const, link: `#profile-${restaurantId}`, key: `${n.key}:${f.id}`, external: f.wa })));
}

export async function reportDecided(db: Queryable, reportId: number, decision: string, reason?: string) {
  const [rep] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!rep) return;
  const ref = reportRef(rep.id);
  const place = (await nameOf(db, rep.restaurantId)) ?? rep.unlistedName ?? "the place";
  const key = `report:${rep.id}:${decision}`;
  if (decision === "accept") {
    await toDiner(db, rep.userId, {
      type: "report.accepted",
      title: `Report ${ref} accepted`,
      body: rep.share ? `Your report about ${place} was checked and is now on its public profile for 2 weeks.` : `Your report about ${place} was checked. You chose to keep it private, so it's used only to spot patterns.`,
      link: "#account",
      key,
    });
    if (rep.share && rep.restaurantId) {
      const owner = await ownerOf(db, rep.restaurantId);
      if (owner) {
        await notify(db, { userId: owner, audience: "owner", type: "report.new", title: `New report about ${place}`, body: `${rep.category}: ${snippet(rep.text)} Mark it resolved with proof from your dashboard.`, link: "#dashboard", key: `${key}:owner`, external: true });
      }
      await toFollowers(db, rep.restaurantId, [rep.userId, owner], { type: "report.followed", title: `New report about ${place}`, body: `${rep.category}: ${snippet(rep.text)}`, key: `${key}:follow` });
    }
  }
  if (decision === "reject") await toDiner(db, rep.userId, { type: "report.rejected", title: `Report ${ref} couldn't be used`, body: `Reason: ${reason}.`, link: "#account", key });
  if (decision === "false") {
    await toDiner(db, rep.userId, { type: "report.false", title: `Report ${ref} was found to be untrue`, body: "It has been removed. A number with 2 false reports in a week can be banned.", link: "#account", key });
  }
  if (decision === "more") await toDiner(db, rep.userId, { type: "report.more", title: `More needed for report ${ref}`, body: "A moderator asked for another photo. Open My alerts → My reports to add it.", link: "#account", key: `${key}:${Date.now()}` });
}

export async function resolutionDecided(db: Queryable, reportId: number, decision: "approve" | "reject", reason?: string) {
  const [row] = await db
    .select({ rep: reports, resp: restaurantResponses })
    .from(reports)
    .innerJoin(restaurantResponses, eq(restaurantResponses.reportId, reports.id))
    .where(eq(reports.id, reportId))
    .limit(1);
  const rid = row?.rep.restaurantId;
  if (!row || !rid) return;
  const { rep, resp } = row;
  const ref = reportRef(rep.id), place = (await nameOf(db, rid))!;
  const owner = await ownerOf(db, rid);
  const key = `resolution:${rep.id}:${resp.createdAt.getTime()}:${decision}`;
  if (decision === "reject") {
    if (owner) await notify(db, { userId: owner, audience: "owner", type: "resolution.rejected", title: `Your proof on ${ref} wasn't accepted`, body: `Reason: ${reason}. You can send new proof from your dashboard.`, link: "#dashboard", key, external: true });
    return;
  }
  if (owner) await notify(db, { userId: owner, audience: "owner", type: "resolution.approved", title: `Your proof on ${ref} was approved`, body: "It now shows next to the report on your public profile.", link: "#dashboard", key, external: true });
  await toDiner(db, rep.userId, { type: "resolution.reporter", title: `${place} took action on your report ${ref}`, body: snippet(resp.text, 160), link: `#profile-${rid}`, key: `${key}:reporter` });
  await toFollowers(db, rid, [rep.userId, owner], { type: "resolution.followed", title: `${place} fixed a reported problem`, body: snippet(resp.text, 160), key: `${key}:follow` });
}

export async function claimRequested(db: Queryable, claimId: number) {
  const [c] = await db.select({ c: claimRequests, name: restaurants.name }).from(claimRequests).innerJoin(restaurants, eq(restaurants.id, claimRequests.restaurantId)).where(eq(claimRequests.id, claimId)).limit(1);
  if (!c) return;
  const staff = await admins(db);
  await notify(db, staff.map((a): Note => ({ userId: a, audience: "admin", type: "claim.new", title: `New claim: ${c.name}`, body: "Compare the licence certificate with the number, then approve or turn it down within 24 hours.", link: "#admin", key: `claim:${claimId}:new:${a}` })));
}

export async function claimsDecided(db: Queryable, claimIds: number[]) {
  if (!claimIds.length) return;
  const rows = await db.select({ c: claimRequests, name: restaurants.name }).from(claimRequests).innerJoin(restaurants, eq(restaurants.id, claimRequests.restaurantId)).where(inArray(claimRequests.id, claimIds));
  await notify(
    db,
    rows.map(({ c, name }): Note =>
      c.status === "approved"
        ? { userId: c.userId, audience: "owner", type: "claim.approved", title: `Your claim for ${name} is approved`, body: "Your dashboard is open. Start the food safety checkup.", link: "#dashboard", key: `claim:${c.id}:approved`, external: true }
        : { userId: c.userId, audience: "owner", type: "claim.rejected", title: `Your claim for ${name} couldn't be approved`, body: `Reason: ${c.reviewNote}. Write to grievance@platewatch.in if you think this is a mistake.`, link: "#restaurants", key: `claim:${c.id}:rejected`, external: true },
    ),
  );
}

export async function evidenceDecided(db: Queryable, evidenceId: string, decision: string, note?: string | null) {
  if (decision !== "rejected" && decision !== "more") return;
  const [e] = await db.select({ e: evidence, text: requirements.text }).from(evidence).innerJoin(requirements, eq(requirements.id, evidence.requirementId)).where(eq(evidence.id, evidenceId)).limit(1);
  if (!e) return;
  const owner = await ownerOf(db, e.e.restaurantId);
  if (!owner) return;
  await notify(db, {
    userId: owner,
    audience: "owner",
    type: `evidence.${decision}`,
    title: decision === "rejected" ? `Evidence not accepted: ${e.text}` : `More evidence needed: ${e.text}`,
    body: note ? `Reviewer's note: ${note}` : "Open your checkup to see what to send.",
    link: "#dashboard",
    key: `evidence:${evidenceId}:${decision}`,
    external: true,
  });
}

export async function verificationDecided(db: Queryable, restaurantId: number, decision: string) {
  const owner = await ownerOf(db, restaurantId);
  if (!owner) return;
  const name = await nameOf(db, restaurantId);
  const text: Record<string, [string, string]> = {
    approve: [`${name} is now PlateWatch verified`, "The badge shows on your public profile."],
    more: [`PlateWatch needs more before verifying ${name}`, "Open your dashboard to see what's missing."],
    reject: [`Verification of ${name} wasn't approved`, "Open your dashboard for the reviewer's note."],
  };
  const [title, body] = text[decision] ?? ["Verification update", ""];
  await notify(db, { userId: owner, audience: "owner", type: `verification.${decision}`, title, body, link: "#dashboard", key: `verification:${restaurantId}:${decision}:${Date.now()}`, external: true });
}

const ACTION: Record<string, string> = { sus: "Licence suspended", rev: "Licence revoked", imp: "Improvement notice", ok: "Cleared" };

export async function officialAction(db: Queryable, restaurantId: number, actionId: number, type: string, summary: string) {
  const name = await nameOf(db, restaurantId);
  const owner = await ownerOf(db, restaurantId);
  const title = `${ACTION[type] ?? "Official action"}: ${name}`;
  if (owner) await notify(db, { userId: owner, audience: "owner", type: "action.owner", title, body: snippet(summary, 200), link: "#dashboard", key: `action:${actionId}:owner`, external: true });
  await toFollowers(db, restaurantId, [owner], { type: "action.followed", title, body: snippet(summary, 200), key: `action:${actionId}` });
}

