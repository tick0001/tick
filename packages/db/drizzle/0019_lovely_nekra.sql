CREATE TABLE "satisfaction_configs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "satisfaction_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"percentage" integer DEFAULT 30 NOT NULL,
	"delay_days" integer DEFAULT 1 NOT NULL,
	"duration_days" integer DEFAULT 30 NOT NULL,
	"reminder_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "satisfactions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "satisfactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ticket_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"token" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"rating" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "satisfaction_configs" ADD CONSTRAINT "satisfaction_configs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfactions" ADD CONSTRAINT "satisfactions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfactions" ADD CONSTRAINT "satisfactions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "satisfaction_configs_entity_path_gist" ON "satisfaction_configs" USING gist ("entity_path");--> statement-breakpoint
CREATE UNIQUE INDEX "satisfactions_ticket_key" ON "satisfactions" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "satisfactions_token_key" ON "satisfactions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "satisfactions_schedule_idx" ON "satisfactions" USING btree ("requested_at","scheduled_at");--> statement-breakpoint
CREATE INDEX "satisfactions_entity_path_gist" ON "satisfactions" USING gist ("entity_path");