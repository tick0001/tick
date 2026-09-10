-- L'index qui sert le tri par defaut de la liste des tickets.
--
-- La liste ordonne par date d'ouverture decroissante et ecarte les tickets a la
-- corbeille. Aucun index ne servait cette paire : tickets_status_date_idx
-- commence par status, et ne peut donc rien pour un tri sur la seule date.
-- PostgreSQL balayait la table entiere puis triait par tas.
--
-- **Deux colonnes, et il le faut** : la liste ordonne par (date_opened, id), le
-- second departageant deux tickets ouverts a la meme seconde, et c'est aussi ce
-- que compare la pagination par curseur. Un index sur la seule date ne satisfait
-- pas ce tri : le premier jet de cet index ne servait a rien pour cette raison,
-- PostgreSQL triait quand meme.
--
-- Mesure a cinquante mille tickets, sous Row-Level Security, avec le role
-- applicatif et la requete reelle de la liste :
--
--   avec les jointures      Nested Loop sur 50 017 lignes, top-N heapsort  74,0 ms
--   avec les sous-requetes  Index Scan, 51 lignes lues                      0,4 ms
--
-- L'index seul ne suffit pas : tant que la requete joignait entities, le
-- planificateur preferait balayer puis trier. Voir TicketsService.paginate, qui
-- remplace les deux jointures par des sous-requetes scalaires pour cette raison.
--
-- L'index est partiel : la corbeille represente une part negligeable des lignes
-- et n'est consultee qu'a la demande. L'exclure garde l'index petit, et surtout
-- rend la condition deleted_at IS NULL de la liste satisfaite par l'index
-- lui-meme plutot que verifiee ligne a ligne.

CREATE INDEX IF NOT EXISTS "tickets_ouverture_idx"
    ON "tickets" ("date_opened" DESC, "id" DESC)
 WHERE "deleted_at" IS NULL;
