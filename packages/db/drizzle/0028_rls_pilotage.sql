-- =============================================================================
-- Pilotage : isolation.
--
-- Deux natures d'objet, deux regles :
--
--   * `recurring_tickets` et `dashboards` sont de la **configuration**. Definis
--     sur un ancetre avec le drapeau recursif, ils servent toute la descendance
--     — un tableau de bord ecrit une fois vaut pour toutes les filiales. D'ou
--     la regle ascendante `tick_config_visible`.
--
--     La recurrence n'a pas de drapeau recursif : elle produit des tickets dans
--     une entite precise, et les faire naitre ailleurs que la ou la recurrence
--     est declaree n'aurait aucun sens. Elle est donc visible comme une
--     configuration non recursive, c'est-a-dire de sa seule entite et de ses
--     descendants au sens de `tick_config_visible`.
--
--   * `unavailabilities` et `recurrence_runs` sont des **donnees** : visibilite
--     descendante pour la premiere, portee par la recurrence pour la seconde.
--
-- `dashboard_widgets` n'a pas d'entite : sa visibilite est celle de son tableau
-- de bord, resolue par jointure. Lui donner une colonne d'entite aurait permis
-- a un widget de survivre au deplacement de son tableau, ce qui n'a pas de sens.
-- =============================================================================

CREATE TRIGGER recurring_tickets_entity_trg BEFORE INSERT OR UPDATE ON recurring_tickets
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER unavailabilities_entity_trg BEFORE INSERT OR UPDATE ON unavailabilities
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER dashboards_entity_trg BEFORE INSERT OR UPDATE ON dashboards
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
      'tickets', 'problems', 'changes',
      'itil_followups', 'itil_tasks', 'itil_solutions',
      'itil_validations', 'itil_costs', 'logs', 'saved_searches',
      'notification_templates', 'notification_queue', 'documents',
      'calendars', 'agreements', 'rules',
      'mail_collectors', 'mail_collector_logs',
      'satisfaction_configs', 'satisfactions',
      'kb_categories', 'kb_articles',
      'forms', 'form_submissions',
      'recurring_tickets', 'unavailabilities', 'dashboards'
    ] LOOP
      EXECUTE format('UPDATE %I SET entity_path = $1 WHERE entity_id = $2', cible)
        USING NEW.path, NEW.id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

ALTER TABLE recurring_tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_tickets_scope ON recurring_tickets FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, false))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE recurrence_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurrence_runs_scope ON recurrence_runs FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM recurring_tickets r WHERE r.id = recurring_id
       AND tick_config_visible(r.entity_path, false)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM recurring_tickets r WHERE r.id = recurring_id
       AND r.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

ALTER TABLE unavailabilities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY unavailabilities_scope ON unavailabilities FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dashboards_scope ON dashboards FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dashboard_widgets_scope ON dashboard_widgets FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM dashboards d WHERE d.id = dashboard_id
       AND tick_config_visible(d.entity_path, d.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM dashboards d WHERE d.id = dashboard_id
       AND d.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  recurring_tickets, recurrence_runs, unavailabilities, dashboards, dashboard_widgets
  TO tick_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tick_app;
