CREATE TYPE "public"."actor_role" AS ENUM('requester', 'observer', 'assigned');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'group', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."followup_source" AS ENUM('interface', 'email', 'phone', 'other');--> statement-breakpoint
CREATE TYPE "public"."itil_link_type" AS ENUM('linked', 'duplicate', 'child');--> statement-breakpoint
CREATE TYPE "public"."itil_status" AS ENUM('new', 'assigned', 'planned', 'waiting', 'solved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."itil_type" AS ENUM('ticket', 'problem', 'change');--> statement-breakpoint
CREATE TYPE "public"."solution_state" AS ENUM('proposed', 'accepted', 'refused');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('information', 'todo', 'done');--> statement-breakpoint
CREATE TYPE "public"."template_field_kind" AS ENUM('predefined', 'mandatory', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('incident', 'request');--> statement-breakpoint
CREATE TYPE "public"."validation_state" AS ENUM('waiting', 'granted', 'refused');--> statement-breakpoint
CREATE TABLE "itil_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "itil_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"path" "ltree" NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"complete_name" text NOT NULL,
	"comment" text,
	"is_helpdesk_visible" boolean DEFAULT true NOT NULL,
	"for_incident" boolean DEFAULT true NOT NULL,
	"for_request" boolean DEFAULT true NOT NULL,
	"for_problem" boolean DEFAULT true NOT NULL,
	"for_change" boolean DEFAULT true NOT NULL,
	"default_technician_id" bigint,
	"default_group_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"path" "ltree" NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"complete_name" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_sources" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"comment" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "solution_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "solution_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
CREATE TABLE "suppliers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suppliers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"comment" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"path" "ltree" NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"complete_name" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "itil_actors" (
	"itil_type" "itil_type" NOT NULL,
	"itil_id" bigint NOT NULL,
	"role" "actor_role" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" bigint NOT NULL,
	"alternative_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itil_actors_itil_type_itil_id_role_actor_type_actor_id_pk" PRIMARY KEY("itil_type","itil_id","role","actor_type","actor_id")
);
--> statement-breakpoint
CREATE TABLE "itil_costs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "itil_costs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itil_type" "itil_type" NOT NULL,
	"itil_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"name" text NOT NULL,
	"begin_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"action_time" integer DEFAULT 0 NOT NULL,
	"cost_time" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_fixed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_material" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itil_followups" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "itil_followups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itil_type" "itil_type" NOT NULL,
	"itil_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"content" text NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"source" "followup_source" DEFAULT 'interface' NOT NULL,
	"author_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "itil_links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "itil_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_type" "itil_type" NOT NULL,
	"source_id" bigint NOT NULL,
	"target_type" "itil_type" NOT NULL,
	"target_id" bigint NOT NULL,
	"link_type" "itil_link_type" DEFAULT 'linked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itil_solutions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "itil_solutions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itil_type" "itil_type" NOT NULL,
	"itil_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"content" text NOT NULL,
	"solution_type_id" bigint,
	"status" "solution_state" DEFAULT 'proposed' NOT NULL,
	"author_id" bigint,
	"approver_id" bigint,
	"approval_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "itil_tasks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "itil_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itil_type" "itil_type" NOT NULL,
	"itil_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"content" text NOT NULL,
	"state" "task_state" DEFAULT 'todo' NOT NULL,
	"category_id" bigint,
	"is_private" boolean DEFAULT false NOT NULL,
	"action_time" integer DEFAULT 0 NOT NULL,
	"begin_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"technician_id" bigint,
	"group_id" bigint,
	"author_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "itil_validations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "itil_validations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itil_type" "itil_type" NOT NULL,
	"itil_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"requester_id" bigint,
	"validator_type" "actor_type" DEFAULT 'user' NOT NULL,
	"validator_id" bigint NOT NULL,
	"answered_by_id" bigint,
	"status" "validation_state" DEFAULT 'waiting' NOT NULL,
	"request_comment" text,
	"response_comment" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_template_fields" (
	"template_id" bigint NOT NULL,
	"field" text NOT NULL,
	"kind" "template_field_kind" NOT NULL,
	"value" text,
	CONSTRAINT "ticket_template_fields_template_id_field_kind_pk" PRIMARY KEY("template_id","field","kind")
);
--> statement-breakpoint
CREATE TABLE "ticket_templates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ticket_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
CREATE TABLE "tickets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tickets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"type" "ticket_type" DEFAULT 'incident' NOT NULL,
	"status" "itil_status" DEFAULT 'new' NOT NULL,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"urgency" integer DEFAULT 3 NOT NULL,
	"impact" integer DEFAULT 3 NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"category_id" bigint,
	"request_source_id" bigint,
	"location_id" bigint,
	"template_id" bigint,
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
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_type" text NOT NULL,
	"item_id" bigint NOT NULL,
	"entity_id" bigint,
	"entity_path" "ltree",
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itil_categories" ADD CONSTRAINT "itil_categories_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_categories" ADD CONSTRAINT "itil_categories_default_technician_id_users_id_fk" FOREIGN KEY ("default_technician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_categories" ADD CONSTRAINT "itil_categories_default_group_id_groups_id_fk" FOREIGN KEY ("default_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_categories" ADD CONSTRAINT "itil_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."itil_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_sources" ADD CONSTRAINT "request_sources_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_types" ADD CONSTRAINT "solution_types_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."task_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_costs" ADD CONSTRAINT "itil_costs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_followups" ADD CONSTRAINT "itil_followups_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_followups" ADD CONSTRAINT "itil_followups_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_solutions" ADD CONSTRAINT "itil_solutions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_solutions" ADD CONSTRAINT "itil_solutions_solution_type_id_solution_types_id_fk" FOREIGN KEY ("solution_type_id") REFERENCES "public"."solution_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_solutions" ADD CONSTRAINT "itil_solutions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_solutions" ADD CONSTRAINT "itil_solutions_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_tasks" ADD CONSTRAINT "itil_tasks_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_tasks" ADD CONSTRAINT "itil_tasks_category_id_task_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."task_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_tasks" ADD CONSTRAINT "itil_tasks_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_tasks" ADD CONSTRAINT "itil_tasks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_tasks" ADD CONSTRAINT "itil_tasks_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_validations" ADD CONSTRAINT "itil_validations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_validations" ADD CONSTRAINT "itil_validations_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itil_validations" ADD CONSTRAINT "itil_validations_answered_by_id_users_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_template_fields" ADD CONSTRAINT "ticket_template_fields_template_id_ticket_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ticket_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_templates" ADD CONSTRAINT "ticket_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_itil_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."itil_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_request_source_id_request_sources_id_fk" FOREIGN KEY ("request_source_id") REFERENCES "public"."request_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_template_id_ticket_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ticket_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itil_categories_path_gist" ON "itil_categories" USING gist ("path");--> statement-breakpoint
CREATE INDEX "itil_categories_entity_path_gist" ON "itil_categories" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "locations_entity_path_gist" ON "locations" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "request_sources_entity_path_gist" ON "request_sources" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "solution_types_entity_path_gist" ON "solution_types" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "suppliers_entity_path_gist" ON "suppliers" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "task_categories_entity_path_gist" ON "task_categories" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "itil_actors_object_idx" ON "itil_actors" USING btree ("itil_type","itil_id");--> statement-breakpoint
CREATE INDEX "itil_actors_actor_idx" ON "itil_actors" USING btree ("actor_type","actor_id","role");--> statement-breakpoint
CREATE INDEX "itil_costs_object_idx" ON "itil_costs" USING btree ("itil_type","itil_id");--> statement-breakpoint
CREATE INDEX "itil_followups_object_idx" ON "itil_followups" USING btree ("itil_type","itil_id","created_at");--> statement-breakpoint
CREATE INDEX "itil_followups_entity_path_gist" ON "itil_followups" USING gist ("entity_path");--> statement-breakpoint
CREATE UNIQUE INDEX "itil_links_unique" ON "itil_links" USING btree ("source_type","source_id","target_type","target_id","link_type");--> statement-breakpoint
CREATE INDEX "itil_links_target_idx" ON "itil_links" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "itil_solutions_object_idx" ON "itil_solutions" USING btree ("itil_type","itil_id","created_at");--> statement-breakpoint
CREATE INDEX "itil_solutions_entity_path_gist" ON "itil_solutions" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "itil_tasks_object_idx" ON "itil_tasks" USING btree ("itil_type","itil_id");--> statement-breakpoint
CREATE INDEX "itil_tasks_planning_idx" ON "itil_tasks" USING btree ("technician_id","begin_at");--> statement-breakpoint
CREATE INDEX "itil_tasks_entity_path_gist" ON "itil_tasks" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "itil_validations_object_idx" ON "itil_validations" USING btree ("itil_type","itil_id");--> statement-breakpoint
CREATE INDEX "itil_validations_validator_idx" ON "itil_validations" USING btree ("validator_type","validator_id","status");--> statement-breakpoint
CREATE INDEX "ticket_templates_entity_path_gist" ON "ticket_templates" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "tickets_entity_path_gist" ON "tickets" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "tickets_status_date_idx" ON "tickets" USING btree ("status","date_opened" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_entity_status_idx" ON "tickets" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "tickets_category_idx" ON "tickets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tickets_due_idx" ON "tickets" USING btree ("date_due");--> statement-breakpoint
CREATE INDEX "logs_item_idx" ON "logs" USING btree ("item_type","item_id","created_at");--> statement-breakpoint
CREATE INDEX "logs_entity_path_gist" ON "logs" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "logs_created_idx" ON "logs" USING btree ("created_at");