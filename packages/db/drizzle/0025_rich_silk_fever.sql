CREATE TABLE "changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"status" "itil_status" DEFAULT 'new' NOT NULL,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"urgency" integer DEFAULT 3 NOT NULL,
	"impact" integer DEFAULT 3 NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"category_id" bigint,
	"location_id" bigint,
	"date_opened" timestamp with time zone DEFAULT now() NOT NULL,
	"date_due" timestamp with time zone,
	"date_taken_into_account" timestamp with time zone,
	"date_solved" timestamp with time zone,
	"date_closed" timestamp with time zone,
	"take_into_account_delay" integer,
	"solve_delay" integer,
	"close_delay" integer,
	"waiting_duration" integer DEFAULT 0 NOT NULL,
	"waiting_since" timestamp with time zone,
	"internal_time" integer DEFAULT 0 NOT NULL,
	"validation_status" "validation_state",
	"created_by_id" bigint,
	"updated_by_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deployment_plan" text,
	"rollback_plan" text,
	"validation_plan" text,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "problems_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"status" "itil_status" DEFAULT 'new' NOT NULL,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"urgency" integer DEFAULT 3 NOT NULL,
	"impact" integer DEFAULT 3 NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"category_id" bigint,
	"location_id" bigint,
	"date_opened" timestamp with time zone DEFAULT now() NOT NULL,
	"date_due" timestamp with time zone,
	"date_taken_into_account" timestamp with time zone,
	"date_solved" timestamp with time zone,
	"date_closed" timestamp with time zone,
	"take_into_account_delay" integer,
	"solve_delay" integer,
	"close_delay" integer,
	"waiting_duration" integer DEFAULT 0 NOT NULL,
	"waiting_since" timestamp with time zone,
	"internal_time" integer DEFAULT 0 NOT NULL,
	"validation_status" "validation_state",
	"created_by_id" bigint,
	"updated_by_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"symptoms" text,
	"causes" text,
	"impacts" text
);
--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_category_id_itil_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."itil_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_category_id_itil_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."itil_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changes_entity_path_gist" ON "changes" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "changes_status_date_idx" ON "changes" USING btree ("status","date_opened" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "changes_category_idx" ON "changes" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "problems_entity_path_gist" ON "problems" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "problems_status_date_idx" ON "problems" USING btree ("status","date_opened" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "problems_category_idx" ON "problems" USING btree ("category_id");