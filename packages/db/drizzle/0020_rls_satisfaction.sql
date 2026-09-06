-- =============================================================================
-- Isolation du parametrage et des enquetes de satisfaction.
--
-- Le parametrage est une configuration : visibilite ascendante, une entite
-- heritant de l'ancetre recursif qui en declare. Les enquetes, elles, sont des
-- donnees rattachees a un ticket : visibilite descendante.
-- =============================================================================

CREATE TRIGGER satisfaction_configs_entity_trg BEFORE INSERT OR UPDATE ON satisfaction_configs
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER satisfactions_entity_trg BEFORE INSERT OR UPDATE ON satisfactions
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
      'satisfaction_configs', 'satisfactions'
    ] LOOP
      EXECUTE format('UPDATE %I SET entity_path = $1 WHERE entity_id = $2', cible)
        USING NEW.path, NEW.id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

ALTER TABLE satisfaction_configs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY satisfaction_configs_scope ON satisfaction_configs FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE satisfactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY satisfactions_scope ON satisfactions FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
