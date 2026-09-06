-- =============================================================================
-- Problemes et changements : isolation.
--
-- Ce sont des **donnees**, comme les tickets : visibilite descendante. Un
-- probleme ouvert dans une filiale ne remonte pas au siege du seul fait que le
-- siege est un ancetre.
--
-- Les satellites — acteurs, suivis, taches, solutions, validations, couts,
-- liens — sont deja polymorphes et deja proteges : leurs politiques resolvent
-- l'objet parent par son type. Rien a y ajouter, et c'est precisement ce que
-- l'on gagne a ne pas avoir invente une table par type de satellite.
-- =============================================================================

CREATE TRIGGER problems_entity_trg BEFORE INSERT OR UPDATE ON problems
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER changes_entity_trg BEFORE INSERT OR UPDATE ON changes
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
      'forms', 'form_submissions'
    ] LOOP
      EXECUTE format('UPDATE %I SET entity_path = $1 WHERE entity_id = $2', cible)
        USING NEW.path, NEW.id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

ALTER TABLE problems ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY problems_scope ON problems FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint

ALTER TABLE changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY changes_scope ON changes FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));

--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Les satellites peuvent desormais viser un probleme ou un changement.
--
-- La fonction etait ecrite en attendant ce jalon : elle refusait tout ce qui
-- n'etait pas un ticket, ce qui etait exact tant qu'aucun autre objet
-- n'existait, et deviendrait faux des le premier suivi sur un probleme.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tick_itil_visible(objet itil_type, identifiant bigint)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE objet
    WHEN 'ticket' THEN EXISTS (
      SELECT 1 FROM public.tickets t WHERE t.id = identifiant AND tick_in_scope(t.entity_path)
    )
    WHEN 'problem' THEN EXISTS (
      SELECT 1 FROM public.problems p WHERE p.id = identifiant AND tick_in_scope(p.entity_path)
    )
    WHEN 'change' THEN EXISTS (
      SELECT 1 FROM public.changes c WHERE c.id = identifiant AND tick_in_scope(c.entity_path)
    )
  END
$fn$;
