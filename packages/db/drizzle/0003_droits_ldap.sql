-- =============================================================================
-- Droits du role applicatif sur les tables d'annuaire, et automatisation des
-- droits pour toutes les tables a venir.
-- =============================================================================

-- Sans cela, chaque nouvelle table du coeur devrait recevoir un GRANT manuel, et
-- l'oubli ne se verrait qu'a l'execution, sous la forme d'un refus de
-- permission en production. Les privileges par defaut valent pour les objets
-- crees ensuite par le role proprietaire, donc par les migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tick_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tick_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tick_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tick_app;
--> statement-breakpoint

-- Les correspondances groupe d'annuaire vers habilitation designent une entite :
-- elles suivent donc la meme regle de visibilite que les autres objets de
-- configuration. Un administrateur d'une branche ne voit pas les regles d'une
-- autre.
--
-- `ldap_directories` n'est en revanche pas rattache a une entite : c'est une
-- configuration globale, au meme titre que les profils ou les comptes. Son
-- acces est garde par le droit `ldap:read` / `ldap:update`, pas par le
-- Row-Level Security, qui n'aurait rien a filtrer.
ALTER TABLE ldap_group_mappings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ldap_group_mappings_scope ON ldap_group_mappings FOR ALL TO tick_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND tick_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND tick_in_scope(e.path)));
