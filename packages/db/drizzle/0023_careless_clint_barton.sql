CREATE TYPE "public"."form_destination_kind" AS ENUM('ticket', 'problem', 'change');--> statement-breakpoint
CREATE TYPE "public"."form_question_kind" AS ENUM('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'user', 'group', 'location', 'category', 'urgency');--> statement-breakpoint
CREATE TYPE "public"."form_target_type" AS ENUM('profile', 'group', 'user');--> statement-breakpoint
CREATE TABLE "form_access" (
	"form_id" bigint NOT NULL,
	"target_type" "form_target_type" NOT NULL,
	"target_id" bigint NOT NULL,
	CONSTRAINT "form_access_form_id_target_type_target_id_pk" PRIMARY KEY("form_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "form_destinations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_destinations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"form_id" bigint NOT NULL,
	"kind" "form_destination_kind" DEFAULT 'ticket' NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_question_conditions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_question_conditions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"question_id" bigint NOT NULL,
	"depends_on_id" bigint NOT NULL,
	"operator" "rule_operator" NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "form_questions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"section_id" bigint NOT NULL,
	"kind" "form_question_kind" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"ranking" integer DEFAULT 0 NOT NULL,
	"options" jsonb,
	"default_value" text
);
--> statement-breakpoint
CREATE TABLE "form_sections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_sections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"form_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ranking" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"form_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"submitted_by_id" bigint,
	"ticket_id" bigint,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_translations" (
	"item_type" text NOT NULL,
	"item_id" bigint NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	CONSTRAINT "form_translations_item_type_item_id_locale_pk" PRIMARY KEY("item_type","item_id","locale")
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"ranking" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "form_access" ADD CONSTRAINT "form_access_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_destinations" ADD CONSTRAINT "form_destinations_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_question_conditions" ADD CONSTRAINT "form_question_conditions_question_id_form_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."form_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_question_conditions" ADD CONSTRAINT "form_question_conditions_depends_on_id_form_questions_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."form_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_questions" ADD CONSTRAINT "form_questions_section_id_form_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."form_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_destinations_form_key" ON "form_destinations" USING btree ("form_id","kind");--> statement-breakpoint
CREATE INDEX "form_question_conditions_question_idx" ON "form_question_conditions" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "form_questions_section_idx" ON "form_questions" USING btree ("section_id","ranking");--> statement-breakpoint
CREATE INDEX "form_sections_form_idx" ON "form_sections" USING btree ("form_id","ranking");--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_entity_path_gist" ON "form_submissions" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "forms_entity_path_gist" ON "forms" USING gist ("entity_path");