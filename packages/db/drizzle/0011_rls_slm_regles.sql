-- =============================================================================
-- Isolation des calendriers, engagements de service et regles.
--
-- Tous sont des objets de **configuration** : une organisation definit ses
-- calendriers et ses engagements a la racine, une filiale aux horaires
-- particuliers les siens. Leurs objets enfants — segments, jours feries,
-- niveaux, criteres, actions — heritent de la visibilite de leur parent.
-- =============================================================================

CREATE TRIGGER calendars_entity_trg BEFORE INSERT OR UPDATE ON calendars
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER agreements_entity_trg BEFORE INSERT OR UPDATE ON agreements
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER rules_entity_trg BEFORE INSERT OR UPDATE ON rules
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
      'calendars', 'agreements', 'rules'
    ] LOOP
      EXECUTE format('UPDATE %I SET entity_path = $1 WHERE entity_id = $2', cible)
        USING NEW.path, NEW.id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

-- Cles etrangeres des engagements sur le ticket.
--
-- Posees en `SET NULL` : supprimer un engagement ne doit pas empecher de
-- consulter les tickets auxquels il s'appliquait.
ALTER TABLE tickets
  ADD CONSTRAINT tickets_sla_tto_fk FOREIGN KEY (sla_tto_id)
    REFERENCES agreements(id) ON DELETE SET NULL,
  ADD CONSTRAINT tickets_sla_ttr_fk FOREIGN KEY (sla_ttr_id)
    REFERENCES agreements(id) ON DELETE SET NULL,
  ADD CONSTRAINT tickets_ola_tto_fk FOREIGN KEY (ola_tto_id)
    REFERENCES agreements(id) ON DELETE SET NULL,
  ADD CONSTRAINT tickets_ola_ttr_fk FOREIGN KEY (ola_ttr_id)
    REFERENCES agreements(id) ON DELETE SET NULL,
  ADD CONSTRAINT tickets_escalation_level_fk FOREIGN KEY (escalation_level_id)
    REFERENCES agreement_levels(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ticket_escalations
  ADD CONSTRAINT ticket_escalations_ticket_fk FOREIGN KEY (ticket_id)
    REFERENCES tickets(id) ON DELETE CASCADE;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Politiques
-- -----------------------------------------------------------------------------
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendars_scope ON calendars FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE calendar_segments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_segments_scope ON calendar_segments FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM calendars c
     WHERE c.id = calendar_id AND tick_config_visible(c.entity_path, c.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM calendars c WHERE c.id = calendar_id AND c.entity_path = tick_entity_path()
  ));
--> statement-breakpoint
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY holidays_scope ON holidays FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM calendars c
     WHERE c.id = calendar_id AND tick_config_visible(c.entity_path, c.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM calendars c WHERE c.id = calendar_id AND c.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agreements_scope ON agreements FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE agreement_levels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agreement_levels_scope ON agreement_levels FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM agreements a
     WHERE a.id = agreement_id AND tick_config_visible(a.entity_path, a.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM agreements a WHERE a.id = agreement_id AND a.entity_path = tick_entity_path()
  ));
--> statement-breakpoint
ALTER TABLE agreement_level_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agreement_level_actions_scope ON agreement_level_actions FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM agreement_levels n
      JOIN agreements a ON a.id = n.agreement_id
     WHERE n.id = level_id AND tick_config_visible(a.entity_path, a.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM agreement_levels n
      JOIN agreements a ON a.id = n.agreement_id
     WHERE n.id = level_id AND a.entity_path = tick_entity_path()
  ));
--> statement-breakpoint

-- La trace d'escalade suit le ticket, qui est une donnee.
ALTER TABLE ticket_escalations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ticket_escalations_scope ON ticket_escalations FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM tickets t WHERE t.id = ticket_id AND tick_in_scope(t.entity_path)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tickets t WHERE t.id = ticket_id AND tick_in_scope(t.entity_path)
  ));
--> statement-breakpoint

ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rules_scope ON rules FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE rule_criteria ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rule_criteria_scope ON rule_criteria FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM rules r
     WHERE r.id = rule_id AND tick_config_visible(r.entity_path, r.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM rules r WHERE r.id = rule_id AND r.entity_path = tick_entity_path()
  ));
--> statement-breakpoint
ALTER TABLE rule_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rule_actions_scope ON rule_actions FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM rules r
     WHERE r.id = rule_id AND tick_config_visible(r.entity_path, r.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM rules r WHERE r.id = rule_id AND r.entity_path = tick_entity_path()
  ));
