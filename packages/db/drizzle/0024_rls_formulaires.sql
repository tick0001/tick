-- =============================================================================
-- Formulaires : isolation.
--
-- Un formulaire est une **configuration** : publie a la racine avec le drapeau
-- recursif, il alimente le catalogue de toute l'arborescence. Ses sections,
-- questions, conditions et traductions heritent de sa visibilite.
--
-- Les soumissions, elles, sont des **donnees** : elles suivent la regle
-- descendante, comme les tickets qu'elles produisent.
-- =============================================================================

CREATE TRIGGER forms_entity_trg BEFORE INSERT OR UPDATE ON forms
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER form_submissions_entity_trg BEFORE INSERT OR UPDATE ON form_submissions
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

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY forms_scope ON forms FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

ALTER TABLE form_sections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY form_sections_scope ON form_sections FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM forms f WHERE f.id = form_id
       AND tick_config_visible(f.entity_path, f.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM forms f WHERE f.id = form_id AND f.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

ALTER TABLE form_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY form_questions_scope ON form_questions FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM form_sections s JOIN forms f ON f.id = s.form_id
     WHERE s.id = section_id AND tick_config_visible(f.entity_path, f.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM form_sections s JOIN forms f ON f.id = s.form_id
     WHERE s.id = section_id AND f.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

ALTER TABLE form_question_conditions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY form_question_conditions_scope ON form_question_conditions FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM form_questions q
      JOIN form_sections s ON s.id = q.section_id
      JOIN forms f ON f.id = s.form_id
     WHERE q.id = question_id AND tick_config_visible(f.entity_path, f.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM form_questions q
      JOIN form_sections s ON s.id = q.section_id
      JOIN forms f ON f.id = s.form_id
     WHERE q.id = question_id AND f.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

ALTER TABLE form_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY form_access_scope ON form_access FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM forms f WHERE f.id = form_id
       AND tick_config_visible(f.entity_path, f.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM forms f WHERE f.id = form_id AND f.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

ALTER TABLE form_destinations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY form_destinations_scope ON form_destinations FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM forms f WHERE f.id = form_id
       AND tick_config_visible(f.entity_path, f.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM forms f WHERE f.id = form_id AND f.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

-- Les traductions sont polymorphes : leur visibilite se resout par l'objet
-- traduit, formulaire, section ou question.
ALTER TABLE form_translations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY form_translations_scope ON form_translations FOR ALL TO tick_app
  USING (
    (item_type = 'form' AND EXISTS (
      SELECT 1 FROM forms f WHERE f.id = item_id
         AND tick_config_visible(f.entity_path, f.is_recursive)))
    OR (item_type = 'section' AND EXISTS (
      SELECT 1 FROM form_sections s JOIN forms f ON f.id = s.form_id
       WHERE s.id = item_id AND tick_config_visible(f.entity_path, f.is_recursive)))
    OR (item_type = 'question' AND EXISTS (
      SELECT 1 FROM form_questions q
        JOIN form_sections s ON s.id = q.section_id
        JOIN forms f ON f.id = s.form_id
       WHERE q.id = item_id AND tick_config_visible(f.entity_path, f.is_recursive)))
  )
  WITH CHECK (
    (item_type = 'form' AND EXISTS (
      SELECT 1 FROM forms f WHERE f.id = item_id AND f.entity_path = tick_entity_path()))
    OR (item_type = 'section' AND EXISTS (
      SELECT 1 FROM form_sections s JOIN forms f ON f.id = s.form_id
       WHERE s.id = item_id AND f.entity_path = tick_entity_path()))
    OR (item_type = 'question' AND EXISTS (
      SELECT 1 FROM form_questions q
        JOIN form_sections s ON s.id = q.section_id
        JOIN forms f ON f.id = s.form_id
       WHERE q.id = item_id AND f.entity_path = tick_entity_path()))
  );
--> statement-breakpoint

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY form_submissions_scope ON form_submissions FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
