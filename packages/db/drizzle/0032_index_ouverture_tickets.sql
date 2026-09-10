-- L'index qui sert le tri par defaut de la liste des tickets.
--
-- La liste ordonne par `date_opened DESC` et ecarte les tickets a la corbeille.
-- Aucun index ne servait cette paire : `tickets_status_date_idx` commence par
-- `status`, et ne peut donc rien pour un tri sur la seule date. PostgreSQL
-- balayait la table entiere puis triait par tas.
--
-- Mesure a cinquante mille tickets, sur la requete de la premiere page :
--
--   sans l'index   Seq Scan sur 50 007 lignes, puis top-N heapsort   18,4 ms
--   avec l'index   Index Scan, cinquante lignes lues                  0,35 ms
--
-- L'index est partiel : la corbeille represente une part negligeable des lignes
-- et n'est consultee qu'a la demande. L'exclure garde l'index petit, et surtout
-- rend la condition `deleted_at IS NULL` de la liste satisfaite par l'index
-- lui-meme plutot que verifiee ligne a ligne.
--
-- Verifie aussi sous Row-Level Security, avec le role applicatif : la politique
-- devient un filtre applique aux lignes remontees par l'index, et non un
-- obstacle a son usage. La lecture reste a 0,5 ms.

CREATE INDEX IF NOT EXISTS "tickets_ouverture_idx"
    ON "tickets" ("date_opened" DESC)
 WHERE "deleted_at" IS NULL;
