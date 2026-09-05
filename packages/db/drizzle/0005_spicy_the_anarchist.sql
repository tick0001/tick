CREATE TYPE "public"."plugin_state" AS ENUM('decouvert', 'installe', 'actif', 'inactif', 'erreur');--> statement-breakpoint
CREATE TABLE "plugin_migrations" (
	"plugin_id" text NOT NULL,
	"filename" text NOT NULL,
	"checksum" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_migrations_plugin_id_filename_pk" PRIMARY KEY("plugin_id","filename")
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"state" "plugin_state" DEFAULT 'decouvert' NOT NULL,
	"sdk_range" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"last_error" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"installed_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_migrations" ADD CONSTRAINT "plugin_migrations_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;