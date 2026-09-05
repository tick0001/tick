CREATE TABLE "ldap_directories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ldap_directories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 389 NOT NULL,
	"use_tls" boolean DEFAULT false NOT NULL,
	"bind_dn" text,
	"bind_password_encrypted" text,
	"base_dn" text NOT NULL,
	"user_filter" text DEFAULT '(objectClass=person)' NOT NULL,
	"login_attribute" text DEFAULT 'uid' NOT NULL,
	"email_attribute" text DEFAULT 'mail' NOT NULL,
	"first_name_attribute" text DEFAULT 'givenName' NOT NULL,
	"last_name_attribute" text DEFAULT 'sn' NOT NULL,
	"group_member_attribute" text DEFAULT 'memberOf' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 5000 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ldap_group_mappings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ldap_group_mappings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"directory_id" bigint NOT NULL,
	"group_dn" text NOT NULL,
	"profile_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_directory_id_ldap_directories_id_fk" FOREIGN KEY ("directory_id") REFERENCES "public"."ldap_directories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ldap_directories_name_key" ON "ldap_directories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ldap_group_mappings_directory_idx" ON "ldap_group_mappings" USING btree ("directory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ldap_group_mappings_key" ON "ldap_group_mappings" USING btree ("directory_id","group_dn","profile_id","entity_id");