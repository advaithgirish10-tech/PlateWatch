CREATE TYPE "public"."action_type" AS ENUM('sus', 'rev', 'imp', 'ok');--> statement-breakpoint
CREATE TYPE "public"."answer" AS ENUM('yes', 'no', 'na');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('photo', 'video', 'document');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('checkup', 'spot');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('submitted', 'more', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."otp_channel" AS ENUM('console', 'whatsapp', 'sms');--> statement-breakpoint
CREATE TYPE "public"."owner_level" AS ENUM('self', 'pending', 'platform');--> statement-breakpoint
CREATE TYPE "public"."report_channel" AS ENUM('web', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."report_evidence_kind" AS ENUM('photo', 'video', 'bill', 'note');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."upload_purpose" AS ENUM('evidence', 'report', 'response');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"role" text NOT NULL,
	"message" text NOT NULL,
	"user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enforcement_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"action_on" date NOT NULL,
	"type" "action_type" NOT NULL,
	"summary" text NOT NULL,
	"authority" text DEFAULT 'FDA Maharashtra' NOT NULL,
	"source_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" integer NOT NULL,
	"requirement_id" text NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"source" "evidence_source" DEFAULT 'checkup' NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"captured_on" date NOT NULL,
	"status" "evidence_status" DEFAULT 'submitted' NOT NULL,
	"note" text,
	"review_note" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"contains_people" boolean DEFAULT false NOT NULL,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" uuid NOT NULL,
	"restaurant_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_user_id_restaurant_id_pk" PRIMARY KEY("user_id","restaurant_id")
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"channel" "otp_channel" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" integer NOT NULL,
	"kind" "report_evidence_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer,
	"unlisted_name" text,
	"unlisted_area" text,
	"user_id" uuid,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"share" boolean NOT NULL,
	"channel" "report_channel" DEFAULT 'web' NOT NULL,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"ask_more" boolean DEFAULT false NOT NULL,
	"reject_reason" text,
	"coordinated" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"sent_to_regulator_on" date,
	"official_action_on" date,
	"flagged_by_owner" boolean DEFAULT false NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_place" CHECK ("reports"."restaurant_id" is not null or "reports"."unlisted_name" is not null)
);
--> statement-breakpoint
CREATE TABLE "requirement_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"expiry_days" integer NOT NULL,
	"sort" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"category_key" text NOT NULL,
	"text" text NOT NULL,
	"weight" smallint NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"sort" smallint NOT NULL,
	CONSTRAINT "requirements_weight_range" CHECK ("requirements"."weight" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"restaurant_id" integer NOT NULL,
	"requirement_id" text NOT NULL,
	"answer" "answer" NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "responses_restaurant_id_requirement_id_pk" PRIMARY KEY("restaurant_id","requirement_id")
);
--> statement-breakpoint
CREATE TABLE "restaurant_owners" (
	"restaurant_id" integer PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "owner_level" DEFAULT 'self' NOT NULL,
	"verified_on" date,
	"requested_on" date,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_responses" (
	"report_id" integer PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"storage_key" text,
	"original_name" text,
	"responded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"city" text NOT NULL,
	"category" text NOT NULL,
	"licence_number" text NOT NULL,
	"location" geometry(point, 4326),
	"search_text" text GENERATED ALWAYS AS (lower(name || ' ' || area || ' ' || city || ' ' || category || ' ' || licence_number)) STORED,
	"current_status" "action_type",
	"current_status_on" date,
	"last_verified_on" date NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurants_licence_number_unique" UNIQUE("licence_number")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "upload_purpose" NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"whatsapp_alerts" boolean DEFAULT true NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"phone_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consent_version" text,
	"consented_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "watched_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"area" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_suggestions" ADD CONSTRAINT "place_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD CONSTRAINT "report_evidence_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_category_key_requirement_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "public"."requirement_categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_owners" ADD CONSTRAINT "restaurant_owners_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_owners" ADD CONSTRAINT "restaurant_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD CONSTRAINT "restaurant_responses_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD CONSTRAINT "restaurant_responses_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watched_areas" ADD CONSTRAINT "watched_areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "actions_restaurant_idx" ON "enforcement_actions" USING btree ("restaurant_id","action_on");--> statement-breakpoint
CREATE INDEX "evidence_status_idx" ON "evidence" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "evidence_restaurant_req_idx" ON "evidence" USING btree ("restaurant_id","requirement_id");--> statement-breakpoint
CREATE INDEX "otp_phone_created_idx" ON "otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "otp_ip_created_idx" ON "otp_challenges" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "reports_restaurant_idx" ON "reports" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_user_idx" ON "reports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "restaurants_location_idx" ON "restaurants" USING gist ("location");--> statement-breakpoint
CREATE INDEX "restaurants_search_trgm_idx" ON "restaurants" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "restaurants_status_idx" ON "restaurants" USING btree ("current_status","current_status_on");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uploads_user_created_idx" ON "uploads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_areas_user_area_idx" ON "watched_areas" USING btree ("user_id",lower("area"));