-- =============================================================================
-- Isolation des boites relevees et de leur journal.
--
-- Une boite n'est pas un objet de configuration partage : elle appartient a une
-- entite et cree ses tickets chez elle. Elle suit donc la regle descendante,
-- comme une donnee, et non la regle ascendante des calendriers ou des modeles —
-- personne ne doit relever la boite de sa maison mere.
-- =============================================================================

CREATE TRIGGER mail_collectors_entity_trg BEFORE INSERT OR UPDATE ON mail_collectors
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER mail_collector_logs_entity_trg BEFORE INSERT OR UPDATE ON mail_collector_logs
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
      'mail_collectors', 'mail_collector_logs'
    ] LOOP
      EXECUTE format('UPDATE %I SET entity_path = $1 WHERE entity_id = $2', cible)
        USING NEW.path, NEW.id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

ALTER TABLE mail_collectors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_collectors_scope ON mail_collectors FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE mail_collector_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_collector_logs_scope ON mail_collector_logs FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM mail_collectors c
     WHERE c.id = collector_id AND tick_in_scope(c.entity_path)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM mail_collectors c
     WHERE c.id = collector_id AND tick_in_scope(c.entity_path)
  ));
