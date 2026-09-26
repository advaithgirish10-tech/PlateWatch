CREATE TYPE "public"."licence_status" AS ENUM('active', 'inactive', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."restaurant_source" AS ENUM('staff', 'osm', 'sample');--> statement-breakpoint
ALTER TABLE "restaurants" ALTER COLUMN "licence_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" drop column "search_text";--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "search_text" text GENERATED ALWAYS AS (lower(name || ' ' || area || ' ' || city || ' ' || category || ' ' || coalesce(licence_number, ''))) STORED;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "licence_status" "licence_status";--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "licence_checked_on" date;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "source" "restaurant_source" DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "osm_id" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_osm_id_unique" UNIQUE("osm_id");--> statement-breakpoint
-- dropping search_text dropped its trigram index: put it back
CREATE INDEX IF NOT EXISTS "restaurants_search_trgm_idx" ON "restaurants" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
UPDATE "restaurants" SET "source" = 'sample' WHERE "is_sample";
