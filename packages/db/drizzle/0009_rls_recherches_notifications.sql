-- =============================================================================
-- Isolation des recherches sauvegardees, des notifications et des documents.
-- =============================================================================

-- Chemins d'entite denormalises.
CREATE TRIGGER saved_searches_entity_trg BEFORE INSERT OR UPDATE ON saved_searches
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER notification_templates_entity_trg BEFORE INSERT OR UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER documents_entity_trg BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint

-- La file d'envoi accepte une entite nulle : une tache automatique peut
-- notifier hors de tout contexte d'entite.
CREATE TRIGGER notification_queue_entity_trg BEFORE INSERT OR UPDATE ON notification_queue
  FOR EACH ROW EXECUTE FUNCTION logs_sync_entity_path();
--> statement-breakpoint

-- Le deplacement d'une entite entraine ces tables comme les autres.
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
      'notification_templates', 'notification_queue', 'documents'
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
-- Politiques
-- -----------------------------------------------------------------------------

-- Une recherche sauvegardee est visible de son auteur, ou de tous si elle est
-- publique. L'ecriture reste reservee a l'auteur : partager une recherche ne
-- donne pas le droit de la modifier.
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY saved_searches_scope ON saved_searches FOR ALL TO tick_app
  USING (tick_in_scope(entity_path) AND (user_id = tick_user_id() OR is_public))
  WITH CHECK (tick_in_scope(entity_path) AND user_id = tick_user_id());
--> statement-breakpoint

-- Les modeles de notification sont de la configuration.
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_templates_scope ON notification_templates FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE notification_template_translations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_template_translations_scope
  ON notification_template_translations FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM notification_templates m
     WHERE m.id = template_id AND tick_config_visible(m.entity_path, m.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM notification_templates m
     WHERE m.id = template_id AND m.entity_path = tick_entity_path()
  ));
--> statement-breakpoint
ALTER TABLE notification_template_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_template_targets_scope
  ON notification_template_targets FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM notification_templates m
     WHERE m.id = template_id AND tick_config_visible(m.entity_path, m.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM notification_templates m
     WHERE m.id = template_id AND m.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

-- La file d'envoi contient le corps des messages, donc potentiellement le
-- contenu des tickets : elle suit la regle des donnees.
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_queue_scope ON notification_queue FOR ALL TO tick_app
  USING (entity_path IS NOT NULL AND tick_in_scope(entity_path))
  WITH CHECK (entity_path IS NULL OR tick_in_scope(entity_path));
--> statement-breakpoint

-- Les preferences n'appartiennent qu'a leur porteur.
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_own ON notification_preferences FOR ALL TO tick_app
  USING (user_id = tick_user_id())
  WITH CHECK (user_id = tick_user_id());
--> statement-breakpoint

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY documents_scope ON documents FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint

-- Le rattachement herite du document : voir le lien sans voir le document
-- revelerait l'existence d'une piece jointe hors perimetre.
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_items_scope ON document_items FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM documents d WHERE d.id = document_id AND tick_in_scope(d.entity_path)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM documents d WHERE d.id = document_id AND tick_in_scope(d.entity_path)
  ));
--> statement-breakpoint

-- Le gabarit par defaut d'une entite doit designer un gabarit existant.
ALTER TABLE entity_settings
  ADD CONSTRAINT entity_settings_default_template_fk
  FOREIGN KEY (default_ticket_template_id) REFERENCES ticket_templates(id) ON DELETE SET NULL;
