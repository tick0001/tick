-- Les acteurs d'un objet ITIL portent enfin leur chemin d'entite.
--
-- `itil_actors` etait la seule table ITIL dont la politique n'etait pas un test
-- de chemin. Elle interrogeait `tick_itil_visible(itil_type, itil_id)`, qui
-- cherche l'objet porteur dans `tickets`, `problems` ou `changes` — **une
-- recherche par ligne lue**. Le cout ne se voit pas sur une fiche de ticket,
-- qui lit cinq acteurs ; il devient le temps de reponse des que la table est
-- balayee. Mesure sur cinq cent mille tickets : un `count(*)` coute 19 ms au
-- proprietaire et 17,7 s au role applicatif, et la repartition des
-- statistiques par technicien vingt secondes.
--
-- Les douze autres satellites — `itil_followups`, `itil_tasks`,
-- `itil_solutions`, `itil_validations`, `itil_costs` — denormalisent deja le
-- chemin et leur politique se reduit a `tick_in_scope(entity_path)`. Les
-- acteurs font desormais de meme : une comparaison d'arbre, sans recherche.
--
-- Deux differences avec les autres, et elles se tiennent. Un suivi recoit son
-- entite de l'application, qui la connait ; un acteur n'a pas d'entite propre,
-- il herite de celle de son objet. Le declencheur la deduit donc du porteur
-- plutot que de la lire dans la ligne : c'est la seule facon de garantir
-- qu'elles ne divergent jamais, et un `itil_id` force vers un objet invisible
-- ne resout rien, donc ne passe pas le `WITH CHECK`. Et faute d'entite propre,
-- la table ne porte pas `entity_id` : la propagation d'un deplacement la vise
-- par le chemin, qui vaut exactement celui de l'entite deplacee.

ALTER TABLE itil_actors ADD COLUMN entity_path ltree DEFAULT 'herite'::ltree;
--> statement-breakpoint

UPDATE itil_actors a SET entity_path = t.entity_path
  FROM tickets t WHERE a.itil_type = 'ticket' AND a.itil_id = t.id;
--> statement-breakpoint
UPDATE itil_actors a SET entity_path = p.entity_path
  FROM problems p WHERE a.itil_type = 'problem' AND a.itil_id = p.id;
--> statement-breakpoint
UPDATE itil_actors a SET entity_path = c.entity_path
  FROM changes c WHERE a.itil_type = 'change' AND a.itil_id = c.id;
--> statement-breakpoint

-- Un acteur sans objet porteur n'a jamais rien voulu dire : la ligne est un
-- reliquat, et la garder la rendrait invisible a tous plutot que fausse.
DELETE FROM itil_actors WHERE entity_path = 'herite'::ltree OR entity_path IS NULL;
--> statement-breakpoint

ALTER TABLE itil_actors ALTER COLUMN entity_path SET NOT NULL;
--> statement-breakpoint

-- L'index ne sert pas la politique : le planificateur ne s'en sert nulle part
-- pour un predicat de RLS, dont les tableaux sortent de `current_setting` et
-- n'ont pas de statistiques — meme sur un perimetre de quatre lignes, il balaye.
-- Il sert la propagation, qui vise les acteurs d'une entite par egalite de
-- chemin : 0,3 ms au lieu de 96 ms sur cinq cent mille acteurs.
CREATE INDEX itil_actors_entity_path_gist ON itil_actors USING gist (entity_path);
--> statement-breakpoint

-- La valeur par defaut n'est jamais observee : le declencheur la remplace avant
-- l'ecriture. Elle existe pour que l'application n'ait pas a nommer une colonne
-- qu'elle ne renseigne pas.
CREATE OR REPLACE FUNCTION itil_actors_sync_entity() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  CASE NEW.itil_type
    WHEN 'ticket' THEN
      SELECT t.entity_path INTO NEW.entity_path FROM tickets t WHERE t.id = NEW.itil_id;
    WHEN 'problem' THEN
      SELECT p.entity_path INTO NEW.entity_path FROM problems p WHERE p.id = NEW.itil_id;
    WHEN 'change' THEN
      SELECT c.entity_path INTO NEW.entity_path FROM changes c WHERE c.id = NEW.itil_id;
  END CASE;

  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
ALTER FUNCTION itil_actors_sync_entity() SET search_path = public, pg_temp;
--> statement-breakpoint

-- `UPDATE OF` restreint : la propagation d'un deplacement reecrit `entity_path`
-- directement, et un declencheur qui se redeclencherait la-dessus dependrait de
-- l'ordre des tables dans la boucle de propagation.
CREATE TRIGGER itil_actors_entity_trg
  BEFORE INSERT OR UPDATE OF itil_type, itil_id ON itil_actors
  FOR EACH ROW EXECUTE FUNCTION itil_actors_sync_entity();
--> statement-breakpoint

ALTER POLICY itil_actors_scope ON itil_actors
  USING (tick_in_scope(entity_path))
  WITH CHECK (tick_in_scope(entity_path));
--> statement-breakpoint

-- `itil_links` garde `tick_itil_visible` : la table reste petite, elle n'est
-- jamais balayee, et un lien porte deux objets qui peuvent vivre dans deux
-- entites — un chemin unique ne les representerait pas.

CREATE OR REPLACE FUNCTION entities_propagate_path() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
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

    IF NEW.path IS DISTINCT FROM OLD.path THEN
      UPDATE itil_actors SET entity_path = NEW.path WHERE entity_path = OLD.path;
    END IF;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint
ALTER FUNCTION entities_propagate_path() SET search_path = public, pg_temp;
