-- Journal des envois, dans le schema du plugin.
--
-- Il sert au diagnostic : un administrateur qui ne voit rien arriver dans son
-- canal doit pouvoir dire si le message est parti, et ce que la messagerie a
-- repondu. L'adresse du webhook n'y figure jamais — elle porte le jeton.
--
-- Les lignes de plus de trente jours sont retirees a chaque envoi : un journal
-- de diagnostic n'a pas a grossir sans fin.
CREATE TABLE envois (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  evenement   text NOT NULL,
  ticket_id   bigint NOT NULL,
  entite_id   bigint NOT NULL,
  -- Code HTTP de la reponse ; nul si la requete n'a pas abouti.
  statut      integer,
  erreur      text,
  envoye_le   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX envois_envoye_le_idx ON envois (envoye_le);
