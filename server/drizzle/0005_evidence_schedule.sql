-- How often each part of the checkup needs fresh evidence. Past this, the evidence stops counting and the score drops.
UPDATE "requirement_categories" SET "expiry_days" = 14 WHERE "key" IN ('kitchen', 'storage', 'clean');--> statement-breakpoint
UPDATE "requirement_categories" SET "expiry_days" = 7 WHERE "key" = 'personal';--> statement-breakpoint
UPDATE "requirement_categories" SET "expiry_days" = 30 WHERE "key" = 'ops';--> statement-breakpoint
UPDATE "requirement_categories" SET "expiry_days" = 180 WHERE "key" = 'pest';
