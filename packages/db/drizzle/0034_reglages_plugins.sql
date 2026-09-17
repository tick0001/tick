-- Reglages des plugins.
--
-- Un plugin declare ses reglages dans son manifeste ; le coeur les affiche, les
-- valide, les stocke et en resout l'heritage entre entites. Voir
-- `PluginSettingsService`.
--
-- `NULLS NOT DISTINCT` : la valeur d'instance porte un `entity_id` nul, et deux
-- lignes nulles pour la meme cle doivent se heurter, pas coexister.

CREATE TABLE IF NOT EXISTS "plugin_settings" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "plugin_id" text NOT NULL REFERENCES "plugins"("id") ON DELETE CASCADE,
  "entity_id" bigint REFERENCES "entities"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugin_settings_cle" UNIQUE NULLS NOT DISTINCT ("plugin_id", "entity_id", "key")
);
--> statement-breakpoint

-- Le role applicatif n'y touche pas.
--
-- Les privileges par defaut, poses par la migration 0003, lui ouvrent toute
-- nouvelle table. Or un plugin execute du SQL brut avec ce role : il lirait les
-- reglages des autres plugins — les secrets sont chiffres, le reste non — et
-- pourrait les reecrire sans passer par la validation. Seul le proprietaire lit
-- et ecrit cette table, pour le compte du coeur.
REVOKE ALL ON "plugin_settings" FROM tick_app;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE "plugin_settings_id_seq" FROM tick_app;
