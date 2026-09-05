-- =============================================================================
-- Coherence et isolation des objets ITIL.
--
-- Trois familles de tables, trois regles :
--
--   * referentiels (categories, sources, lieux, gabarits...) : configuration,
--     donc visibilite ascendante conditionnee par `is_recursive` ;
--   * donnees (tickets, suivis, taches, solutions, validations, couts,
--     historique) : visibilite descendante, strictement dans le perimetre ;
--   * satellites sans entite propre (acteurs, liens, champs de gabarit) :
--     visibilite heritee de leur objet parent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Chemins des referentiels arborescents
--
-- Fonction generique plutot qu'une par table : les trois arbres se comportent
-- de la meme facon, et une copie par table finirait par diverger.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION referential_compute_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  parent_path     ltree;
  parent_complete text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path          := ('n' || NEW.id)::ltree;
    NEW.complete_name := NEW.name;
  ELSE
    EXECUTE format('SELECT path, complete_name FROM %I WHERE id = $1', TG_TABLE_NAME)
      INTO parent_path, parent_complete USING NEW.parent_id;

    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent % introuvable dans %', NEW.parent_id, TG_TABLE_NAME;
    END IF;

    IF TG_OP = 'UPDATE' AND parent_path <@ OLD.path THEN
      RAISE EXCEPTION 'Deplacement invalide : un element ne peut pas devenir sa propre descendance';
    END IF;

    NEW.path          := parent_path || ('n' || NEW.id)::ltree;
    NEW.complete_name := parent_complete || ' > ' || NEW.name;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION referential_propagate_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path
     OR NEW.complete_name IS DISTINCT FROM OLD.complete_name THEN
    EXECUTE format('UPDATE %I SET parent_id = parent_id WHERE parent_id = $1', TG_TABLE_NAME)
      USING NEW.id;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

CREATE TRIGGER itil_categories_path_trg BEFORE INSERT OR UPDATE ON itil_categories
  FOR EACH ROW EXECUTE FUNCTION referential_compute_path();
--> statement-breakpoint
CREATE TRIGGER itil_categories_propagate_trg AFTER UPDATE ON itil_categories
  FOR EACH ROW EXECUTE FUNCTION referential_propagate_path();
--> statement-breakpoint
CREATE TRIGGER task_categories_path_trg BEFORE INSERT OR UPDATE ON task_categories
  FOR EACH ROW EXECUTE FUNCTION referential_compute_path();
--> statement-breakpoint
CREATE TRIGGER task_categories_propagate_trg AFTER UPDATE ON task_categories
  FOR EACH ROW EXECUTE FUNCTION referential_propagate_path();
--> statement-breakpoint
CREATE TRIGGER locations_path_trg BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION referential_compute_path();
--> statement-breakpoint
CREATE TRIGGER locations_propagate_trg AFTER UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION referential_propagate_path();
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2. Denormalisation du chemin d'entite
-- -----------------------------------------------------------------------------
CREATE TRIGGER itil_categories_entity_trg BEFORE INSERT OR UPDATE ON itil_categories
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER request_sources_entity_trg BEFORE INSERT OR UPDATE ON request_sources
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER task_categories_entity_trg BEFORE INSERT OR UPDATE ON task_categories
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER solution_types_entity_trg BEFORE INSERT OR UPDATE ON solution_types
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER locations_entity_trg BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER suppliers_entity_trg BEFORE INSERT OR UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER ticket_templates_entity_trg BEFORE INSERT OR UPDATE ON ticket_templates
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER tickets_entity_trg BEFORE INSERT OR UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER itil_followups_entity_trg BEFORE INSERT OR UPDATE ON itil_followups
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER itil_tasks_entity_trg BEFORE INSERT OR UPDATE ON itil_tasks
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER itil_solutions_entity_trg BEFORE INSERT OR UPDATE ON itil_solutions
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER itil_validations_entity_trg BEFORE INSERT OR UPDATE ON itil_validations
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint
CREATE TRIGGER itil_costs_entity_trg BEFORE INSERT OR UPDATE ON itil_costs
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();
--> statement-breakpoint

-- L'historique accepte une entite nulle : une tache automatique peut journaliser
-- hors de tout contexte. Le declencheur generique exigerait une entite.
CREATE OR REPLACE FUNCTION logs_sync_entity_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.entity_id IS NULL THEN
    NEW.entity_path := NULL;
  ELSE
    SELECT path INTO NEW.entity_path FROM entities WHERE id = NEW.entity_id;
  END IF;

  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
CREATE TRIGGER logs_entity_trg BEFORE INSERT OR UPDATE ON logs
  FOR EACH ROW EXECUTE FUNCTION logs_sync_entity_path();
--> statement-breakpoint

-- Un deplacement d'entite doit entrainer tout ce qui y est rattache.
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
      'itil_validations', 'itil_costs', 'logs'
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
-- 3. Visibilite heritee du parent
--
-- `search_path` est fige sur la fonction : sans cela, une transaction de plugin
-- dont le `search_path` commence par son propre schema pourrait faire resoudre
-- `tickets` vers une table qu'il aurait lui-meme creee, et contourner ainsi la
-- verification.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tick_itil_visible(objet itil_type, identifiant bigint)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE objet
    WHEN 'ticket' THEN EXISTS (
      SELECT 1 FROM public.tickets t WHERE t.id = identifiant AND tick_in_scope(t.entity_path)
    )
    -- Problemes et changements arrivent au jalon J7 : jusque-la, aucun
    -- satellite ne peut leur etre rattache, donc rien n'est visible.
    ELSE false
  END
$fn$;
--> statement-breakpoint
ALTER FUNCTION tick_itil_visible(itil_type, bigint) SET search_path = public, pg_temp;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4. Politiques
-- -----------------------------------------------------------------------------

-- Referentiels : configuration.
ALTER TABLE itil_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY itil_categories_scope ON itil_categories FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE request_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY request_sources_scope ON request_sources FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE task_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_categories_scope ON task_categories FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE solution_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY solution_types_scope ON solution_types FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY locations_scope ON locations FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY suppliers_scope ON suppliers FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint
ALTER TABLE ticket_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ticket_templates_scope ON ticket_templates FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  WITH CHECK (entity_path = tick_entity_path());
--> statement-breakpoint

-- Donnees : perimetre strict.
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tickets_scope ON tickets FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint
ALTER TABLE itil_followups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY itil_followups_scope ON itil_followups FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint
ALTER TABLE itil_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY itil_tasks_scope ON itil_tasks FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint
ALTER TABLE itil_solutions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY itil_solutions_scope ON itil_solutions FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint
ALTER TABLE itil_validations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY itil_validations_scope ON itil_validations FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint
ALTER TABLE itil_costs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY itil_costs_scope ON itil_costs FOR ALL TO tick_app
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Une trace sans entite est technique : elle reste invisible du role applicatif.
CREATE POLICY logs_scope ON logs FOR ALL TO tick_app
  USING (entity_path IS NOT NULL AND tick_in_scope(entity_path))
  WITH CHECK (entity_path IS NULL OR tick_in_scope(entity_path));
--> statement-breakpoint

-- Satellites sans entite propre.
ALTER TABLE itil_actors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY itil_actors_scope ON itil_actors FOR ALL TO tick_app
  USING (tick_itil_visible(itil_type, itil_id))
  WITH CHECK (tick_itil_visible(itil_type, itil_id));
--> statement-breakpoint
ALTER TABLE itil_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Les deux extremites doivent etre visibles : afficher un lien vers un objet
-- hors perimetre revelerait son existence.
CREATE POLICY itil_links_scope ON itil_links FOR ALL TO tick_app
  USING (tick_itil_visible(source_type, source_id) AND tick_itil_visible(target_type, target_id))
  WITH CHECK (tick_itil_visible(source_type, source_id) AND tick_itil_visible(target_type, target_id));
--> statement-breakpoint
ALTER TABLE ticket_template_fields ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ticket_template_fields_scope ON ticket_template_fields FOR ALL TO tick_app
  USING (EXISTS (
    SELECT 1 FROM ticket_templates m
     WHERE m.id = template_id AND tick_config_visible(m.entity_path, m.is_recursive)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ticket_templates m
     WHERE m.id = template_id AND m.entity_path = tick_entity_path()
  ));
