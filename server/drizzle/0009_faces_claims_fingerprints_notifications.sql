CREATE TYPE "public"."claim_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."fingerprint_source" AS ENUM('evidence', 'report', 'proof', 'claim');--> statement-breakpoint
CREATE TYPE "public"."notification_audience" AS ENUM('user', 'owner', 'admin');--> statement-breakpoint
ALTER TYPE "public"."upload_purpose" ADD VALUE 'claim';--> statement-breakpoint
CREATE TABLE "claim_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"licence_number" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_fingerprints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" "fingerprint_source" NOT NULL,
	"source_id" text NOT NULL,
	"restaurant_id" integer,
	"user_id" uuid,
	"dhash" bigint,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"match_of" bigint,
	"match_distance" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"audience" "notification_audience" NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"dedupe_key" text NOT NULL,
	"external" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"send_attempts" smallint DEFAULT 0 NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "faces_blurred" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD COLUMN "faces_blurred" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD COLUMN "faces_blurred" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_requests_status_idx" ON "claim_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "claim_requests_user_idx" ON "claim_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_fingerprints_sha_idx" ON "file_fingerprints" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "file_fingerprints_source_idx" ON "file_fingerprints" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","audience","created_at");--> statement-breakpoint
CREATE INDEX "notifications_outbox_idx" ON "notifications" USING btree ("external","sent_at");