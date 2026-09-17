-- Les propagations de chemins s'executent hors du Row-Level Security.
--
-- Deplacer une entite recopie son chemin dans ses sous-entites et dans les
-- trente-cinq tables qui le denormalisent ; deplacer une categorie, un lieu ou
-- une rubrique recalcule le chemin de sa descendance. L'API fait ces
-- deplacements avec le role applicatif, donc sous RLS, et deux choses
-- cedaient :
--
-- - la politique des objets de configuration exige, en ecriture, le chemin de
--   l'entite active. Recopier le nouveau chemin d'une entite sur ses groupes,
--   ses categories ou ses calendriers la violait : **deplacer une entite qui
--   porte un seul objet de configuration echouait** ;
-- - une descendance invisible de l'auteur du deplacement n'etait pas
--   recalculee, et gardait un chemin et un nom complet perimes, sans erreur.
--
-- Le droit de deplacer reste verifie la ou il doit l'etre : sur la ligne
-- deplacee, que le RLS laisse ou non modifier, et dont le nouveau chemin doit
-- rester dans le perimetre. La propagation n'est que la mise en coherence qui
-- s'ensuit, et elle doit atteindre toute la descendance.
--
-- `SECURITY DEFINER` : la fonction s'execute avec les droits de son
-- proprietaire, que le RLS ne concerne pas. Les declencheurs qu'elle provoque
-- aussi. Une fonction de declencheur ne s'appelle pas directement, et son
-- `search_path` est fige pour qu'aucun schema ne s'intercale.

ALTER FUNCTION entities_propagate_path() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION entities_propagate_path() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION referential_propagate_path() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION referential_propagate_path() SET search_path = public, pg_temp;
