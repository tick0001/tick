-- =============================================================================
-- Coherence de l'arbre des entites, et isolation par Row-Level Security.
--
-- Ce fichier porte les garanties que le schema seul ne peut pas exprimer :
-- les chemins ltree restent exacts quoi qu'il arrive, et aucune requete du role
-- applicatif ne peut sortir du perimetre d'entites de la transaction courante.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Chemins de l'arbre des entites
--
-- Le chemin est bati a partir des identifiants (`e12.e37`) et non des noms :
-- il reste ainsi stable a travers les renommages et ne peut pas entrer en
-- collision. La valeur identite est deja disponible dans un declencheur
-- BEFORE INSERT, ce qui permet de la composer des l'ecriture.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION entities_compute_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  parent_path     ltree;
  parent_level    integer;
  parent_complete text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path          := ('e' || NEW.id)::ltree;
    NEW.level         := 0;
    NEW.complete_name := NEW.name;
  ELSE
    SELECT path, level, complete_name
      INTO parent_path, parent_level, parent_complete
      FROM entities
     WHERE id = NEW.parent_id;

    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'Entite parente % introuvable', NEW.parent_id;
    END IF;

    -- Un deplacement sous sa propre descendance detacherait le sous-arbre.
    IF TG_OP = 'UPDATE' AND parent_path <@ OLD.path THEN
      RAISE EXCEPTION 'Deplacement invalide : une entite ne peut pas devenir sa propre descendante';
    END IF;

    NEW.path          := parent_path || ('e' || NEW.id)::ltree;
    NEW.level         := parent_level + 1;
    NEW.complete_name := parent_complete || ' > ' || NEW.name;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

-- Propagation aux descendants.
--
-- La mise a jour se fait enfant par enfant plutot que par un UPDATE global :
-- chaque enfant repasse par le declencheur ci-dessus, qui recalcule son chemin
-- depuis son parent deja mis a jour, puis propage a son tour. La recursion
-- s'arrete d'elle-meme des qu'un niveau ne change plus.
CREATE OR REPLACE FUNCTION entities_propagate_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path
     OR NEW.complete_name IS DISTINCT FROM OLD.complete_name THEN
    UPDATE entities SET parent_id = parent_id WHERE parent_id = NEW.id;
    -- Les groupes suivent l'entite a laquelle ils sont rattaches.
    UPDATE groups SET entity_id = entity_id WHERE entity_id = NEW.id;
  END IF;

  RETURN NULL;
END;
$fn$;

CREATE TRIGGER entities_compute_path_trg
  BEFORE INSERT OR UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_compute_path();

CREATE TRIGGER entities_propagate_path_trg
  AFTER UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_propagate_path();

-- -----------------------------------------------------------------------------
-- 2. Denormalisation du chemin sur les objets rattaches a une entite
--
-- Les politiques comparent un chemin a un autre. Sans cette colonne, chaque
-- verification declencherait une sous-requete sur `entities` et l'index GIST
-- deviendrait inutilisable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_entity_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  SELECT path INTO NEW.entity_path FROM entities WHERE id = NEW.entity_id;

  IF NEW.entity_path IS NULL THEN
    RAISE EXCEPTION 'Entite % introuvable', NEW.entity_id;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER groups_sync_entity_path_trg
  BEFORE INSERT OR UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION sync_entity_path();

-- -----------------------------------------------------------------------------
-- 3. Lecture du contexte de la transaction
--
-- Les parametres sont poses par `set_config(..., true)` a l'ouverture de chaque
-- transaction applicative. Le second argument `true` de `current_setting` evite
-- l'erreur lorsque le parametre est absent : une connexion sans contexte voit
-- alors un perimetre vide, jamais un perimetre total.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tick_entity_path() RETURNS ltree
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('tick.entity_path', true), '')::ltree
$fn$;

CREATE OR REPLACE FUNCTION tick_scope_paths() RETURNS ltree[]
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(NULLIF(current_setting('tick.scope_paths', true), '')::ltree[], '{}'::ltree[])
$fn$;

CREATE OR REPLACE FUNCTION tick_exact_paths() RETURNS ltree[]
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(NULLIF(current_setting('tick.exact_paths', true), '')::ltree[], '{}'::ltree[])
$fn$;

CREATE OR REPLACE FUNCTION tick_user_id() RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('tick.user_id', true), '')::bigint
$fn$;

-- Visibilite descendante : l'objet appartient au perimetre habilite.
CREATE OR REPLACE FUNCTION tick_in_scope(target ltree) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT target <@ tick_scope_paths() OR target = ANY (tick_exact_paths())
$fn$;

-- Visibilite de configuration : le perimetre habilite, plus ce qu'un ancetre
-- partage explicitement vers le bas par son drapeau recursif.
CREATE OR REPLACE FUNCTION tick_config_visible(target ltree, recursive_flag boolean)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT tick_in_scope(target)
      OR (recursive_flag AND target @> tick_entity_path())
$fn$;

-- -----------------------------------------------------------------------------
-- 4. Politiques
--
-- Le role proprietaire n'est pas soumis aux politiques : migrations et amorcage
-- passent par lui. Tout le trafic applicatif passe par `tick_app`.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tick_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tick_app;

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY entities_scope ON entities FOR ALL TO tick_app
  USING (tick_in_scope(path))
  WITH CHECK (tick_in_scope(path));

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_scope ON groups FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  -- Un objet de configuration se cree dans l'entite active, jamais ailleurs
  -- dans le perimetre visible.
  WITH CHECK (entity_path = tick_entity_path());

ALTER TABLE entity_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY entity_settings_scope ON entity_settings FOR ALL TO tick_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND tick_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND tick_in_scope(e.path)));

-- Les habilitations ne sont lisibles que dans le perimetre.
ALTER TABLE authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY authorizations_scope ON authorizations FOR ALL TO tick_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND tick_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND tick_in_scope(e.path)));

-- Une session n'appartient qu'a son porteur.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_own ON sessions FOR ALL TO tick_app
  USING (user_id = tick_user_id())
  WITH CHECK (user_id = tick_user_id());
