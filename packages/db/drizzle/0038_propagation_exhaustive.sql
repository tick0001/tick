-- La propagation des chemins ne recopie plus une liste : elle la deduit.
--
-- **Correctif d'une regression introduite en 0037, publiee dans la 0.1.12.**
-- En reecrivant `entities_propagate_path()` pour y ajouter les acteurs, le
-- corps a ete repris de la migration 0007 et non de la 0028 : le tableau des
-- cibles est retombe de trente-cinq tables a quinze. Vingt tables sortaient
-- donc silencieusement de la propagation :
--
--   problems, changes, agreements, calendars, rules, kb_categories,
--   kb_articles, forms, form_submissions, notification_templates,
--   notification_queue, documents, mail_collectors, mail_collector_logs,
--   satisfaction_configs, satisfactions, saved_searches, recurring_tickets,
--   unavailabilities, dashboards
--
-- Consequence, apres tout deplacement d'entite : leurs lignes gardaient
-- l'ancien chemin. Le Row-Level Security les laissait donc **visibles depuis
-- la branche d'origine et invisibles depuis la nouvelle** — une disparition et
-- une fuite a la fois, sans aucune erreur. Exactement le mode de defaillance
-- que le chemin denormalise existe pour rendre impossible.
--
-- Deux corrections, et la seconde compte autant que la premiere.
--
-- **1. La liste est derivee du catalogue.** Neuf migrations successives
-- redefinissaient cette fonction en rallongeant un tableau litteral recopie a
-- la main ; ce n'etait pas une liste, c'etait une dette qui grossissait a
-- chaque module. Les cibles sont desormais les tables ordinaires de `public`
-- qui portent a la fois `entity_id` et `entity_path` — ce qui est precisement
-- la definition de « table dont le chemin doit suivre ». Une table ajoutee
-- demain est propagee sans que personne y pense, et aucune ne peut ressortir
-- de la liste par recopie.
--
-- Le role applicatif n'a que `USAGE` sur `public`, pas `CREATE` : ni lui ni un
-- plugin ne peuvent y glisser une table que la boucle ramasserait. Les schemas
-- de plugins, eux, ne sont pas visites.
--
-- **2. Les donnees deja abimees sont remises d'aplomb.** Une installation qui a
-- deplace une entite sous la 0.1.12 porte des chemins perimes. La resynchro
-- ci-dessous ne touche que les lignes qui divergent : elle ne coute rien la ou
-- rien n'a bouge. `itil_actors` y figure par prudence, bien que 0037 l'ait
-- traitee des l'origine ; sur une grosse installation, c'est la seule etape
-- qui se compte en dizaines de secondes.

CREATE OR REPLACE FUNCTION entities_propagate_path() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  cible text;
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path
     OR NEW.complete_name IS DISTINCT FROM OLD.complete_name THEN
    UPDATE entities SET parent_id = parent_id WHERE parent_id = NEW.id;

    FOR cible IN
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind = 'r' AND c.relname <> 'entities'
       GROUP BY c.relname
      HAVING bool_or(a.attname = 'entity_id') AND bool_or(a.attname = 'entity_path')
       ORDER BY c.relname
    LOOP
      EXECUTE format('UPDATE %I SET entity_path = $1 WHERE entity_id = $2', cible)
        USING NEW.path, NEW.id;
    END LOOP;

    -- Les acteurs n'ont pas d'entite propre : leur chemin est celui de leur
    -- objet, et il vaut exactement celui de l'entite deplacee.
    IF NEW.path IS DISTINCT FROM OLD.path THEN
      UPDATE itil_actors SET entity_path = NEW.path WHERE entity_path = OLD.path;
    END IF;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint
ALTER FUNCTION entities_propagate_path() SET search_path = public, pg_temp;
--> statement-breakpoint

DO $reparation$
DECLARE
  cible text;
  reprises bigint;
BEGIN
  FOR cible IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relkind = 'r' AND c.relname <> 'entities'
     GROUP BY c.relname
    HAVING bool_or(a.attname = 'entity_id') AND bool_or(a.attname = 'entity_path')
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'UPDATE %I t SET entity_path = e.path FROM entities e
        WHERE e.id = t.entity_id AND t.entity_path IS DISTINCT FROM e.path', cible);
    GET DIAGNOSTICS reprises = ROW_COUNT;

    IF reprises > 0 THEN
      RAISE NOTICE 'Chemins remis d''aplomb dans % : % ligne(s).', cible, reprises;
    END IF;
  END LOOP;

  UPDATE itil_actors a SET entity_path = t.entity_path
    FROM tickets t
   WHERE a.itil_type = 'ticket' AND a.itil_id = t.id
     AND a.entity_path IS DISTINCT FROM t.entity_path;
  GET DIAGNOSTICS reprises = ROW_COUNT;
  IF reprises > 0 THEN
    RAISE NOTICE 'Chemins remis d''aplomb dans itil_actors (tickets) : % ligne(s).', reprises;
  END IF;

  UPDATE itil_actors a SET entity_path = p.entity_path
    FROM problems p
   WHERE a.itil_type = 'problem' AND a.itil_id = p.id
     AND a.entity_path IS DISTINCT FROM p.entity_path;

  UPDATE itil_actors a SET entity_path = c.entity_path
    FROM changes c
   WHERE a.itil_type = 'change' AND a.itil_id = c.id
     AND a.entity_path IS DISTINCT FROM c.entity_path;
END
$reparation$;
