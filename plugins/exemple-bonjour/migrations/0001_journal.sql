-- Table du plugin, creee dans son propre schema.
--
-- Le `search_path` de la migration place `plugin_exemple_bonjour` en premier :
-- ce `CREATE TABLE` sans prefixe cree bien la table du plugin, et il serait
-- impossible d'ecraser une table du coeur par inadvertance.
CREATE TABLE journal (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  evenement   text NOT NULL,
  detail      text,
  survenu_le  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX journal_survenu_le_idx ON journal (survenu_le DESC);
