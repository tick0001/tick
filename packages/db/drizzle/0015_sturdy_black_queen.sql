ALTER TYPE "public"."notification_target" ADD VALUE 'assigned_group_manager';--> statement-breakpoint
ALTER TYPE "public"."notification_target" ADD VALUE 'requester_group';--> statement-breakpoint
ALTER TYPE "public"."notification_target" ADD VALUE 'requester_group_manager';--> statement-breakpoint
ALTER TYPE "public"."notification_target" ADD VALUE 'followup_author';--> statement-breakpoint
ALTER TYPE "public"."notification_target" ADD VALUE 'fixed';--> statement-breakpoint
ALTER TABLE "notification_template_targets" ADD COLUMN "address" text;