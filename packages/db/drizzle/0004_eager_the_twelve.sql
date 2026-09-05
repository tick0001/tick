CREATE TYPE "public"."ldap_group_search_mode" AS ENUM('attribute', 'search');--> statement-breakpoint
ALTER TABLE "ldap_directories" ALTER COLUMN "group_member_attribute" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "ldap_directories" ADD COLUMN "group_search_mode" "ldap_group_search_mode" DEFAULT 'attribute' NOT NULL;--> statement-breakpoint
ALTER TABLE "ldap_directories" ADD COLUMN "member_of_attribute" text DEFAULT 'memberOf' NOT NULL;--> statement-breakpoint
ALTER TABLE "ldap_directories" ADD COLUMN "group_base_dn" text;--> statement-breakpoint
ALTER TABLE "ldap_directories" ADD COLUMN "group_filter" text DEFAULT '(objectClass=groupOfNames)' NOT NULL;--> statement-breakpoint
-- La colonne change de sens : elle designait l'attribut porte par l'utilisateur
-- (`memberOf`), elle designe maintenant celui porte par le groupe (`member`).
-- Les lignes existantes conservent sinon une valeur qui n'a plus de signification.
UPDATE ldap_directories SET group_member_attribute = 'member'
 WHERE group_member_attribute = 'memberOf';
