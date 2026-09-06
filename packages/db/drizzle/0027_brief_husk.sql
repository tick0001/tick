CREATE TYPE "public"."recurrence_step" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "dashboard_widgets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dashboard_widgets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dashboard_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"width" integer DEFAULT 6 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dashboards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"owner_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurrence_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurrence_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"recurring_id" bigint NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"ticket_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_tickets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_tickets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"template_id" bigint NOT NULL,
	"step" "recurrence_step" DEFAULT 'weekly' NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"begin_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"create_ahead_minutes" integer DEFAULT 0 NOT NULL,
	"next_occurrence_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_by_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unavailabilities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unavailabilities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"user_id" bigint NOT NULL,
	"begin_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_runs" ADD CONSTRAINT "recurrence_runs_recurring_id_recurring_tickets_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_template_id_ticket_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ticket_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailabilities" ADD CONSTRAINT "unavailabilities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailabilities" ADD CONSTRAINT "unavailabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailabilities" ADD CONSTRAINT "unavailabilities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_widgets_dashboard_idx" ON "dashboard_widgets" USING btree ("dashboard_id","position");--> statement-breakpoint
CREATE INDEX "dashboards_entity_path_gist" ON "dashboards" USING gist ("entity_path");--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_runs_unique" ON "recurrence_runs" USING btree ("recurring_id","occurrence_at");--> statement-breakpoint
CREATE INDEX "recurring_tickets_entity_path_gist" ON "recurring_tickets" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "recurring_tickets_due_idx" ON "recurring_tickets" USING btree ("next_occurrence_at");--> statement-breakpoint
CREATE INDEX "unavailabilities_user_idx" ON "unavailabilities" USING btree ("user_id","begin_at");--> statement-breakpoint
CREATE INDEX "unavailabilities_entity_path_gist" ON "unavailabilities" USING gist ("entity_path");