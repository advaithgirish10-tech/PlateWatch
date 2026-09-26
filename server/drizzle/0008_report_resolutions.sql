CREATE TYPE "public"."proof_kind" AS ENUM('photo', 'document');--> statement-breakpoint
CREATE TYPE "public"."resolution_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD COLUMN "proof_kind" "proof_kind";--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD COLUMN "status" "resolution_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restaurant_responses" ADD CONSTRAINT "restaurant_responses_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- replies written before proof was required stay public as they were
UPDATE "restaurant_responses" SET "status" = 'approved';
