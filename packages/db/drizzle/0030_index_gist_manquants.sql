-- Index GiST manquants sur les chemins d'entite lus par le Row-Level Security.
--
-- `tick_in_scope` est une fonction SQL STABLE d'une seule instruction : le
-- planificateur l'inline et voit `entity_path <@ tick_scope_paths()`, qu'un
-- index GiST peut servir. Sans lui, chaque lecture de ces trois tables balaie
-- l'integralite des lignes avant d'en ecarter la majorite.
--
-- `notification_queue` est la plus exposee : le worker la sonde en boucle.
--
-- `mail_collector_logs` porte aussi un `entity_path`, mais sa politique passe
-- par une jointure sur `mail_collectors` et ne lit jamais cette colonne : elle
-- n'a donc pas besoin de l'index.

CREATE INDEX IF NOT EXISTS "itil_costs_entity_path_gist" ON "itil_costs" USING gist ("entity_path");
CREATE INDEX IF NOT EXISTS "itil_validations_entity_path_gist" ON "itil_validations" USING gist ("entity_path");
CREATE INDEX IF NOT EXISTS "notification_queue_entity_path_gist" ON "notification_queue" USING gist ("entity_path");
