-- Les tables sans politique de securite, et ce que le role applicatif y garde.
--
-- Le Row-Level Security cloisonne ce qui appartient a une entite. Quelques
-- tables servent toute l'installation et n'en ont pas : leur acces est garde
-- par les droits au controleur. Ce n'est pas une raison pour laisser le role
-- applicatif tout y faire — un plugin execute du SQL avec ce role, et une
-- requete mal ecrite aussi. Chacune recoit ici le minimum dont l'application
-- a besoin, et `docs/03` en tient la liste.

-- Annuaires, plugins, migrations de plugins : l'API n'y accede qu'en
-- proprietaire. Le role applicatif n'a rien a y lire — `ldap_directories`
-- porte les mots de passe, chiffres, des comptes de service — ni a y ecrire :
-- un plugin se serait marque actif, ou aurait efface la trace de ses
-- migrations.
REVOKE ALL ON "ldap_directories" FROM tick_app;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE "ldap_directories_id_seq" FROM tick_app;
--> statement-breakpoint
REVOKE ALL ON "plugins" FROM tick_app;
--> statement-breakpoint
REVOKE ALL ON "plugin_migrations" FROM tick_app;
--> statement-breakpoint

-- Comptes : l'administration les cree et les modifie avec le role
-- applicatif, condensat compris. Elle n'a jamais besoin de le relire —
-- l'authentification se fait en proprietaire. La lecture est donc accordee
-- colonne par colonne, sans `password_hash`.
--
-- **Toute colonne ajoutee a `users` doit etre accordee ici en lecture** : un
-- droit de colonne ne s'etend pas aux colonnes futures. Un test compare les
-- deux listes.
REVOKE SELECT ON "users" FROM tick_app;
--> statement-breakpoint
GRANT SELECT (
  "id", "username", "email", "first_name", "last_name", "auth_source", "ldap_dn",
  "locale", "is_active", "default_entity_id", "last_login_at", "created_at",
  "updated_at", "deleted_at"
) ON "users" TO tick_app;
--> statement-breakpoint

-- Appartenances : lisibles de tous, puisqu'elles servent a resoudre les droits
-- et les cibles d'articles a travers les entites ; modifiables seulement la
-- ou le groupe est defini. C'est la regle du groupe lui-meme, dont la
-- politique exige en ecriture le chemin de l'entite active : sans elle, un
-- administrateur de filiale ajoutait des membres a un groupe recursif de la
-- maison mere, qu'il ne pouvait pas modifier.
CREATE OR REPLACE FUNCTION tick_groupe_modifiable(groupe bigint) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM groups g WHERE g.id = groupe AND g.entity_path = tick_entity_path()
  )
$fn$;
--> statement-breakpoint
ALTER TABLE "group_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY group_members_lecture ON "group_members" FOR SELECT TO tick_app
  USING (true);
--> statement-breakpoint
CREATE POLICY group_members_ajout ON "group_members" FOR INSERT TO tick_app
  WITH CHECK (tick_groupe_modifiable(group_id));
--> statement-breakpoint
CREATE POLICY group_members_modification ON "group_members" FOR UPDATE TO tick_app
  USING (tick_groupe_modifiable(group_id))
  WITH CHECK (tick_groupe_modifiable(group_id));
--> statement-breakpoint
CREATE POLICY group_members_retrait ON "group_members" FOR DELETE TO tick_app
  USING (tick_groupe_modifiable(group_id));
