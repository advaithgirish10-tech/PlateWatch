import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  geometry,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const otpChannel = pgEnum("otp_channel", ["console", "whatsapp", "sms"]);
/* official actions, same codes as the frontend: suspended, revoked, improvement notice, reinstated */
export const actionType = pgEnum("action_type", ["sus", "rev", "imp", "ok"]);
export const ownerLevel = pgEnum("owner_level", ["self", "pending", "platform"]);
export const answer = pgEnum("answer", ["yes", "no", "na"]);
export const evidenceKind = pgEnum("evidence_kind", ["photo", "video", "document"]);
export const evidenceStatus = pgEnum("evidence_status", ["submitted", "more", "verified", "rejected"]);
export const evidenceSource = pgEnum("evidence_source", ["checkup", "spot"]);
export const reportStatus = pgEnum("report_status", ["pending", "accepted", "rejected"]);
export const reportChannel = pgEnum("report_channel", ["web", "whatsapp"]);
export const reportEvidenceKind = pgEnum("report_evidence_kind", ["photo", "video", "bill", "note"]);
export const uploadPurpose = pgEnum("upload_purpose", ["evidence", "report", "response"]);

/* ---------- people and sign-in ---------- */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* E.164, e.g. +919876543210 */
  phone: text("phone").notNull().unique(),
  name: text("name"),
  whatsappAlerts: boolean("whatsapp_alerts").notNull().default(true),
  role: userRole("role").notNull().default("user"),
  /* first successful verification: how long a number has been known (reports from new numbers weigh less) */
  phoneVerifiedAt: ts("phone_verified_at").notNull().defaultNow(),
  consentVersion: text("consent_version"),
  consentedAt: ts("consented_at"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    channel: otpChannel("channel").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    ip: text("ip"),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("otp_phone_created_idx").on(t.phone, t.createdAt), index("otp_ip_created_idx").on(t.ip, t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /* sha256 of the cookie token; the token itself is never stored */
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ---------- restaurants and the official record ---------- */

export const restaurants = pgTable(
  "restaurants",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    area: text("area").notNull(),
    city: text("city").notNull(),
    category: text("category").notNull(),
    licenceNumber: text("licence_number").notNull().unique(),
    /* drizzle-kit leaves the SRID out of generated SQL: new geometry columns need "4326" added to the migration by hand */
    location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
    /* one lowercase string for substring and typo-tolerant (trigram) search */
    searchText: text("search_text").generatedAlwaysAs(
      sql`lower(name || ' ' || area || ' ' || city || ' ' || category || ' ' || licence_number)`,
    ),
    /* latest official action, kept in step with enforcement_actions by the service that writes them */
    currentStatus: actionType("current_status"),
    currentStatusOn: date("current_status_on"),
    lastVerifiedOn: date("last_verified_on").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("restaurants_location_idx").using("gist", t.location),
    index("restaurants_search_trgm_idx").using("gin", sql`${t.searchText} gin_trgm_ops`),
    index("restaurants_status_idx").on(t.currentStatus, t.currentStatusOn),
  ],
);

export const enforcementActions = pgTable(
  "enforcement_actions",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    actionOn: date("action_on").notNull(),
    type: actionType("type").notNull(),
    summary: text("summary").notNull(),
    authority: text("authority").notNull().default("FDA Maharashtra"),
    sourceUrl: text("source_url"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("actions_restaurant_idx").on(t.restaurantId, t.actionOn)],
);

export const follows = pgTable(
  "follows",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.restaurantId] })],
);

export const watchedAreas = pgTable(
  "watched_areas",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    area: text("area").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("watched_areas_user_area_idx").on(t.userId, sql`lower(${t.area})`)],
);

export const correctionRequests = pgTable("correction_requests", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  message: text("message").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: ts("resolved_at"),
  createdAt: createdAt(),
});

export const placeSuggestions = pgTable("place_suggestions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  area: text("area").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/* ---------- restaurant side: the 27-item checkup and its evidence ---------- */

export const requirementCategories = pgTable("requirement_categories", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  expiryDays: integer("expiry_days").notNull(),
  sort: smallint("sort").notNull(),
});

export const requirements = pgTable(
  "requirements",
  {
    id: text("id").primaryKey(),
    categoryKey: text("category_key")
      .notNull()
      .references(() => requirementCategories.key),
    text: text("text").notNull(),
    weight: smallint("weight").notNull(),
    critical: boolean("critical").notNull().default(false),
    sort: smallint("sort").notNull(),
  },
  (t) => [check("requirements_weight_range", sql`${t.weight} between 1 and 5`)],
);

export const restaurantOwners = pgTable("restaurant_owners", {
  /* one owner per restaurant */
  restaurantId: integer("restaurant_id")
    .primaryKey()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  level: ownerLevel("level").notNull().default("self"),
  verifiedOn: date("verified_on"),
  requestedOn: date("requested_on"),
  adminNote: text("admin_note"),
  claimedAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const responses = pgTable(
  "responses",
  {
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    requirementId: text("requirement_id")
      .notNull()
      .references(() => requirements.id),
    answer: answer("answer").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.restaurantId, t.requirementId] })],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    requirementId: text("requirement_id")
      .notNull()
      .references(() => requirements.id),
    kind: evidenceKind("kind").notNull(),
    source: evidenceSource("source").notNull().default("checkup"),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /* expiry counts from this date */
    capturedOn: date("captured_on").notNull(),
    status: evidenceStatus("status").notNull().default("submitted"),
    note: text("note"),
    reviewNote: text("review_note"),
    flagged: boolean("flagged").notNull().default(false),
    containsPeople: boolean("contains_people").notNull().default(false),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("evidence_status_idx").on(t.status, t.createdAt),
    index("evidence_restaurant_req_idx").on(t.restaurantId, t.requirementId),
  ],
);

/* a presigned upload waiting to be attached to evidence, a report or a response */
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: uploadPurpose("purpose").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    originalName: text("original_name").notNull(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("uploads_user_created_idx").on(t.userId, t.createdAt)],
);

/* ---------- community reports ---------- */

export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").references(() => restaurants.id, { onDelete: "cascade" }),
    unlistedName: text("unlisted_name"),
    unlistedArea: text("unlisted_area"),
    /* set null on account deletion: the report stays, anonymous */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    text: text("text").notNull(),
    share: boolean("share").notNull(),
    channel: reportChannel("channel").notNull().default("web"),
    status: reportStatus("status").notNull().default("pending"),
    askMore: boolean("ask_more").notNull().default(false),
    rejectReason: text("reject_reason"),
    coordinated: boolean("coordinated").notNull().default(false),
    notifiedAt: ts("notified_at"),
    sentToRegulatorOn: date("sent_to_regulator_on"),
    officialActionOn: date("official_action_on"),
    flaggedByOwner: boolean("flagged_by_owner").notNull().default(false),
    moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "set null" }),
    moderatedAt: ts("moderated_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reports_restaurant_idx").on(t.restaurantId, t.createdAt),
    index("reports_user_idx").on(t.userId, t.createdAt),
    index("reports_status_idx").on(t.status, t.createdAt),
    check("reports_place", sql`${t.restaurantId} is not null or ${t.unlistedName} is not null`),
  ],
);

export const reportEvidence = pgTable("report_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  kind: reportEvidenceKind("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  originalName: text("original_name").notNull(),
  createdAt: createdAt(),
});

export const restaurantResponses = pgTable("restaurant_responses", {
  reportId: integer("report_id")
    .primaryKey()
    .references(() => reports.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  storageKey: text("storage_key"),
  originalName: text("original_name"),
  respondedBy: uuid("responded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/* ---------- audit ---------- */

/* append-only: a trigger in the migrations rejects UPDATE and DELETE. No foreign keys, so deleting a user never rewrites history. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt)],
);
