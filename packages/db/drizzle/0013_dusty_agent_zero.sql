ALTER TABLE "tickets" ADD COLUMN "date_due_internal" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "date_due_own_internal" timestamp with time zone;