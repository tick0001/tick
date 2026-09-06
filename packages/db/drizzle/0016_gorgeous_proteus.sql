CREATE TYPE "public"."mail_action" AS ENUM('ticket', 'followup', 'ignored', 'refused', 'error');--> statement-breakpoint
CREATE TYPE "public"."mail_after_read" AS ENUM('delete', 'flag', 'move');--> statement-breakpoint
CREATE TABLE "mail_collector_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_collector_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collector_id" bigint NOT NULL,
	"entity_id" bigint,
	"entity_path" "ltree",
	"message_id" text,
	"sender" text,
	"subject" text,
	"action" "mail_action" NOT NULL,
	"ticket_id" bigint,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_collectors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_collectors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 993 NOT NULL,
	"use_tls" boolean DEFAULT true NOT NULL,
	"login" text NOT NULL,
	"password_encrypted" text,
	"folder" text DEFAULT 'INBOX' NOT NULL,
	"after_read" "mail_after_read" DEFAULT 'flag' NOT NULL,
	"target_folder" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"request_source_id" bigint,
	"create_unknown_requester" boolean DEFAULT false NOT NULL,
	"max_per_run" integer DEFAULT 50 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_queue" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "mail_collector_logs" ADD CONSTRAINT "mail_collector_logs_collector_id_mail_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."mail_collectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_collector_logs" ADD CONSTRAINT "mail_collector_logs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_collectors" ADD CONSTRAINT "mail_collectors_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_collectors" ADD CONSTRAINT "mail_collectors_request_source_id_request_sources_id_fk" FOREIGN KEY ("request_source_id") REFERENCES "public"."request_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_collector_logs_collector_idx" ON "mail_collector_logs" USING btree ("collector_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_collector_logs_message_idx" ON "mail_collector_logs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_collectors_entity_path_gist" ON "mail_collectors" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "notification_queue_message_idx" ON "notification_queue" USING btree ("message_id");