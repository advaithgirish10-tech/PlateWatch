CREATE TYPE "public"."session_kind" AS ENUM('user', 'owner');--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" "session_kind" DEFAULT 'user' NOT NULL;