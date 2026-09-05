CREATE TYPE "public"."agreement_axis" AS ENUM('tto', 'ttr');--> statement-breakpoint
CREATE TYPE "public"."agreement_kind" AS ENUM('sla', 'ola');--> statement-breakpoint
CREATE TYPE "public"."escalation_action" AS ENUM('set_priority', 'set_urgency', 'assign_group', 'assign_user', 'add_observer', 'notify');--> statement-breakpoint
CREATE TYPE "public"."rule_action_type" AS ENUM('assign', 'append', 'regex_result', 'clear');--> statement-breakpoint
CREATE TYPE "public"."rule_collection" AS ENUM('ticket.create', 'ticket.update', 'authorization.assign', 'entity.assign', 'dictionary.ticket');--> statement-breakpoint
CREATE TYPE "public"."rule_operator" AS ENUM('is', 'is_not', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex', 'not_regex', 'under', 'not_under', 'is_empty', 'is_not_empty');--> statement-breakpoint
CREATE TABLE "agreement_level_actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agreement_level_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"level_id" bigint NOT NULL,
	"action" "escalation_action" NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "agreement_levels" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agreement_levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agreement_id" bigint NOT NULL,
	"name" text NOT NULL,
	"offset_seconds" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agreements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"kind" "agreement_kind" DEFAULT 'sla' NOT NULL,
	"axis" "agreement_axis" DEFAULT 'ttr' NOT NULL,
	"name" text NOT NULL,
	"comment" text,
	"duration" integer NOT NULL,
	"calendar_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_segments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_segments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"calendar_id" bigint NOT NULL,
	"weekday" integer NOT NULL,
	"begin_at" time NOT NULL,
	"end_at" time NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendars_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "holidays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"calendar_id" bigint NOT NULL,
	"name" text NOT NULL,
	"day" date NOT NULL,
	"is_perpetual" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rule_id" bigint NOT NULL,
	"field" text NOT NULL,
	"action" "rule_action_type" DEFAULT 'assign' NOT NULL,
	"value" text,
	"options" jsonb
);
--> statement-breakpoint
CREATE TABLE "rule_criteria" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_criteria_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rule_id" bigint NOT NULL,
	"field" text NOT NULL,
	"operator" "rule_operator" NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"collection" "rule_collection" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ranking" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"match_all" boolean DEFAULT true NOT NULL,
	"stop_after" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_escalations" (
	"ticket_id" bigint NOT NULL,
	"level_id" bigint NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_escalations_ticket_id_level_id_pk" PRIMARY KEY("ticket_id","level_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "date_due_own" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sla_tto_id" bigint;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sla_ttr_id" bigint;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ola_tto_id" bigint;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ola_ttr_id" bigint;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalation_level_id" bigint;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agreement_level_actions" ADD CONSTRAINT "agreement_level_actions_level_id_agreement_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."agreement_levels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_levels" ADD CONSTRAINT "agreement_levels_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_segments" ADD CONSTRAINT "calendar_segments_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_actions" ADD CONSTRAINT "rule_actions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_criteria" ADD CONSTRAINT "rule_criteria_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_level_id_agreement_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."agreement_levels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_level_actions_level_idx" ON "agreement_level_actions" USING btree ("level_id");--> statement-breakpoint
CREATE INDEX "agreement_levels_order_idx" ON "agreement_levels" USING btree ("agreement_id","offset_seconds");--> statement-breakpoint
CREATE INDEX "agreements_entity_path_gist" ON "agreements" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "calendar_segments_calendar_idx" ON "calendar_segments" USING btree ("calendar_id","weekday");--> statement-breakpoint
CREATE INDEX "calendars_entity_path_gist" ON "calendars" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "holidays_calendar_idx" ON "holidays" USING btree ("calendar_id","day");--> statement-breakpoint
CREATE INDEX "rule_actions_rule_idx" ON "rule_actions" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "rule_criteria_rule_idx" ON "rule_criteria" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "rules_collection_idx" ON "rules" USING btree ("collection","is_active","ranking");--> statement-breakpoint
CREATE INDEX "rules_entity_path_gist" ON "rules" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "tickets_escalation_idx" ON "tickets" USING btree ("escalation_at");