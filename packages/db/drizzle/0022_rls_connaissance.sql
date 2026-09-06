-- =============================================================================
-- Base de connaissances : arborescence, isolation, recherche plein texte.
--
-- Les articles sont des objets de **configuration** : une organisation redige
-- ses procedures a la racine, une filiale les siennes. La visibilite ascendante
-- s'applique donc, comme aux gabarits ou aux calendriers.
--
-- Le ciblage fin — profil, groupe, utilisateur — n'est pas ici : il depend des
-- groupes de la personne connectee, que la session ne porte pas. Il se resout
-- dans la requete, comme les portees de droits.
-- =============================================================================

CREATE TRIGGER kb_categories_path_trg BEFORE INSERT OR UPDATE ON kb_categories
  FOR EACH ROW EXECUTE FUNCTION referential_compute_path();
--> statement-breakpoint
CREATE TRIGGER kb_categories_propagate_trg AFTER UPDATE ON kb_categories
  FOR EACH ROW EXECUTE FUNCTION referential_propagate_path();
--> statement-breakpoint
CREATE TRIGGER kb_categories_entity_trg BEFORE INSERT OR UPDATE ON kb_categories
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER kb_articles_entity_trg BEFORE INSERT OR UPDATE ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION entities_propagate_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  cible text;
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path
     OR NEW.complete_name IS DISTINCT FROM OLD.complete_name THEN
    UPDATE entities SET parent_id = parent_id WHERE parent_id = NEW.id;

    FOREACH cible IN ARRAY ARRAY[
      'groups', 'itil_categories', 'request_sources', 'task_categories',
      'solution_types', 'locations', 'suppliers', 'ticket_templates',
      'tickets', 'itil_followups', 'itil_tasks', 'itil_solutions',
      'itil_validations', 'itil_costs', 'logs', 'saved_searches',
      'notification_templates', 'notification_queue', 'documents',
      'calendars', 'agreements', 'rules',
      'mail_collectors', 'mail_collector_logs',
      'satisfaction_configs', 'satisfactions',
      'kb_categories', 'kb_articles'
    ] LOOP
      EXECUTE format('UPDATE %I SET entity_path = $1 WHERE entity_id = $2', cible)
        USING NEW.path, NEW.id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Recherche plein texte
--
-- Colonne generee plutot que declencheur : la base garantit alors qu'elle est
-- toujours a jour, y compris pour une ecriture faite hors de l'application.
-- Le titre pese plus que le corps, un article se cherchant d'abord par son nom.
-- -----------------------------------------------------------------------------
ALTER TABLE kb_articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('french', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('french', coalesce(content, '')), 'B')
  ) STORED;
--> statement-breakpoint
CREATE INDEX kb_articles_search_idx ON kb_articles USING gin (search_vector);
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Politiques
-- -----------------------------------------------------------------------------
ALTER TABLE kb_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kb_categories_scope ON kb_categories FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kb_articles_scope ON kb_articles FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE kb_article_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kb_article_revisions_scope ON kb_article_revisions FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM kb_articles a
     WHERE a.id = article_id AND tick_config_visible(a.entity_path, a.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM kb_articles a WHERE a.id = article_id AND a.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

ALTER TABLE kb_article_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kb_article_targets_scope ON kb_article_targets FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM kb_articles a
     WHERE a.id = article_id AND tick_config_visible(a.entity_path, a.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM kb_articles a WHERE a.id = article_id AND a.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

-- Un favori n'appartient qu'a son proprietaire, comme une preference.
ALTER TABLE kb_favorites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kb_favorites_own ON kb_favorites FOR ALL TO tick_app
  USING (user_id = tick_user_id())
  WITH CHECK (user_id = tick_user_id());
