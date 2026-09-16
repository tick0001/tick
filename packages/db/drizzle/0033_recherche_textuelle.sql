-- La recherche textuelle sur les tickets, servie par un index malgre le
-- Row-Level Security.
--
-- -----------------------------------------------------------------------------
-- Le probleme
-- -----------------------------------------------------------------------------
--
-- Chercher « imprimante » dans les titres balayait toute la table : 680 a 820 ms a
-- cinq cent mille tickets, et un plafond de quatre requetes par seconde. Un index
-- trigramme n'y changeait rien, et la raison est structurelle.
--
-- PostgreSQL refuse d'evaluer un predicat non *leakproof* avant le predicat de
-- securite d'une politique : un message d'erreur ou une duree pourrait trahir une
-- ligne interdite. Or aucun operateur de recherche textuelle ne l'est — ni
-- `ILIKE`, ni `@@`, ni `%`. L'index ne peut donc pas servir de condition d'acces.
-- Pour la meme raison, le planificateur s'interdit de consulter les statistiques
-- de la colonne : il estimait **une** ligne la ou il y en a 62 501, et choisissait
-- ses plans en consequence.
--
-- -----------------------------------------------------------------------------
-- La reponse : l'index trouve les candidats, le RLS garde le dernier mot
-- -----------------------------------------------------------------------------
--
-- `tick_tickets_semblables` interroge l'index en tant que proprietaire, donc hors
-- Row-Level Security, et ne rend **que des identifiants**. Elle applique elle-meme
-- `tick_in_scope(entity_path)`, le predicat exact de l'unique politique de la
-- table : elle ne rend que ce que le RLS laisserait voir a l'appelant. La
-- requete visible filtre ensuite sur ces identifiants — une egalite, qui est
-- *leakproof* — et reste soumise au RLS.
--
-- Pourquoi une fonction et non une vue sans barriere de securite : une vue
-- laisserait l'appelant evaluer ses propres predicats sur les lignes avant le
-- filtre de perimetre. Un plugin, qui dispose du role applicatif et du SQL brut,
-- pourrait y glisser une fonction qui recopie chaque titre qu'elle voit. Ici,
-- l'appelant ne fournit qu'un motif ; il ne choisit ni les colonnes ni les
-- conditions.
--
-- Ce qui fuit encore, et qu'il faut savoir : la duree. L'index remonte les
-- correspondances de toutes les entites avant le filtre de perimetre, si bien
-- que le temps d'execution croit avec le nombre de tickets semblables ailleurs.
-- C'est un canal faible — il ne revele ni un titre, ni un identifiant — et la
-- requete precedente, qui balayait toute la table, en avait un du meme ordre.
--
-- -----------------------------------------------------------------------------
-- Le plafond, et les correspondances denses
-- -----------------------------------------------------------------------------
--
-- La fonction s'arrete a `plafond` identifiants. L'application demande un de
-- plus que ce qu'elle sait traiter : si elle les recoit tous, les
-- correspondances sont denses, et parcourir la liste dans l'ordre jusqu'au
-- premier ecran est bien plus rapide que filtrer sur des dizaines de milliers
-- d'identifiants. Voir `SondeTextuelle`.
--
-- Le planificateur ne choisit pas ce parcours de lui-meme : prive de
-- statistiques, il croit qu'un `ILIKE` ne retient presque rien. L'operateur
-- `~~~*` ci-dessous le lui dit autrement.
--
-- -----------------------------------------------------------------------------
-- Mesures, cinq cent mille tickets, role applicatif
-- -----------------------------------------------------------------------------
--
--   terme selectif, 1 ticket          867 ms  ->  sonde 3,6 ms, liste 2,6 ms
--   titre ou description              1374 ms ->  0,9 ms
--   terme dense, 62 501 tickets       679 ms  ->  sonde 24 ms, liste 3,7 ms
--   dense, titre ou description                ->  1,8 ms
--   dense et filtres restrictifs      88 ms   ->  93 ms, meme plan
--
-- Les deux index pesent 27 et 24 Mio pour une table de 234 Mio, et se
-- construisent en trois secondes chacun a ce volume. Ils bloquent les ecritures
-- sur les tickets pendant leur construction : la migration se joue a l'arret de
-- l'API, comme toutes les autres.

CREATE INDEX IF NOT EXISTS "tickets_nom_trgm_idx"
    ON "tickets" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_contenu_trgm_idx"
    ON "tickets" USING gin ("content" gin_trgm_ops);
--> statement-breakpoint

-- `SECURITY DEFINER` impose un `search_path` fige : sans lui, l'appelant pourrait
-- placer devant `public` un schema ou il aurait defini son propre `ILIKE`, que la
-- fonction executerait avec les droits du proprietaire.
--
-- Le texte de la requete ne depend que de `champs`, compare a une liste fermee ;
-- le motif et le plafond passent en parametres. `EXECUTE` plutot qu'une requete
-- statique : le plan est etabli avec le motif connu, et l'index trigramme n'est
-- choisi que lorsqu'il sert.
CREATE OR REPLACE FUNCTION tick_tickets_semblables(motif text, champs text, plafond integer)
RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  condition text;
BEGIN
  condition := CASE champs
    WHEN 'titre' THEN 'name ILIKE $1'
    WHEN 'description' THEN 'content ILIKE $1'
    WHEN 'tous' THEN '(name ILIKE $1 OR content ILIKE $1)'
  END;

  IF condition IS NULL THEN
    RAISE EXCEPTION 'Champ de recherche inconnu : %', champs;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT id FROM tickets WHERE ' || condition
      || ' AND tick_in_scope(entity_path) LIMIT $2'
    USING motif, plafond;
END;
$fn$;
--> statement-breakpoint

-- `ILIKE`, a l'identique, mais estime autrement.
--
-- Meme fonction, `texticlike` : meme resultat, meme evaluation apres le filtre
-- de securite. Seul change l'estimateur. Celui d'`ILIKE` n'a pas le droit de
-- lire les statistiques d'une table sous Row-Level Security, et suppose alors
-- qu'une ligne sur des centaines de milliers correspond — le planificateur
-- balaie la table puis trie. `neqsel`, prive des memes statistiques, suppose
-- presque toutes les lignes retenues, et le planificateur parcourt la liste
-- dans l'ordre jusqu'au premier ecran.
--
-- Ce n'est pas un mensonge commode : l'application ne l'emploie **que** quand la
-- sonde a trouve plus de deux mille correspondances visibles, et le
-- planificateur continue de raisonner sur tous les autres filtres. Mesure : le
-- pire cas — un terme dense et des filtres qui ne retiennent presque rien —
-- garde le plan d'avant, 93 ms contre 88.
--
-- L'estimateur ne lit aucune valeur de la colonne, seulement son nombre de
-- valeurs distinctes : il ne fait rien fuiter.
CREATE OPERATOR public.~~~* (
  LEFTARG = text,
  RIGHTARG = text,
  FUNCTION = texticlike,
  RESTRICT = neqsel
);
--> statement-breakpoint
REVOKE ALL ON FUNCTION tick_tickets_semblables(text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tick_tickets_semblables(text, text, integer) TO tick_app;
