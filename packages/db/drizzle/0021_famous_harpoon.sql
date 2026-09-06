CREATE TYPE "public"."kb_target_type" AS ENUM('profile', 'group', 'user');--> statement-breakpoint
CREATE TABLE "kb_article_revisions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "kb_article_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"article_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"author_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_article_targets" (
	"article_id" bigint NOT NULL,
	"target_type" "kb_target_type" NOT NULL,
	"target_id" bigint NOT NULL,
	CONSTRAINT "kb_article_targets_article_id_target_type_target_id_pk" PRIMARY KEY("article_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "kb_articles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT true NOT NULL,
	"category_id" bigint,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"is_faq" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_id" bigint,
	"updated_by_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kb_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "kb_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"path" "ltree" NOT NULL,
	"entity_id" bigint NOT NULL,
	"entity_path" "ltree" NOT NULL,
	"is_recursive" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"complete_name" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kb_favorites" (
	"user_id" bigint NOT NULL,
	"article_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_favorites_user_id_article_id_pk" PRIMARY KEY("user_id","article_id")
);
--> statement-breakpoint
ALTER TABLE "kb_article_revisions" ADD CONSTRAINT "kb_article_revisions_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_revisions" ADD CONSTRAINT "kb_article_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_targets" ADD CONSTRAINT "kb_article_targets_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."kb_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_favorites" ADD CONSTRAINT "kb_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_favorites" ADD CONSTRAINT "kb_favorites_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_article_revisions_key" ON "kb_article_revisions" USING btree ("article_id","version");--> statement-breakpoint
CREATE INDEX "kb_articles_entity_path_gist" ON "kb_articles" USING gist ("entity_path");--> statement-breakpoint
CREATE INDEX "kb_articles_category_idx" ON "kb_articles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "kb_articles_faq_idx" ON "kb_articles" USING btree ("is_faq","is_published");--> statement-breakpoint
CREATE INDEX "kb_categories_path_gist" ON "kb_categories" USING gist ("path");--> statement-breakpoint
CREATE INDEX "kb_categories_entity_path_gist" ON "kb_categories" USING gist ("entity_path");