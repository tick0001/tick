-- Extensions requises par Tick&.
--   ltree     : arbre des entites, des categories ITIL et des lieux
--   pg_trgm   : recherche approximative sur les libelles
--   unaccent  : recherche plein texte insensible aux accents
--   citext    : adresses de courriel et identifiants insensibles a la casse
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- Role applicatif soumis au Row-Level Security.
-- Le role proprietaire (tick) en est exempte et n'est utilise que pour les migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tick_app') THEN
    CREATE ROLE tick_app LOGIN PASSWORD 'tick_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE tick TO tick_app;
GRANT USAGE ON SCHEMA public TO tick_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tick_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tick_app;

-- Collation francaise explicite, appliquee aux colonnes de libelles triees a l'affichage.
-- Declaree ici plutot que forcee a l'initialisation du cluster : le fournisseur ICU impose
-- des arguments d'initdb fragiles selon l'environnement, alors qu'une collation nommee est
-- portable et s'applique la ou elle est utile.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'fr_icu') THEN
    CREATE COLLATION fr_icu (provider = icu, locale = 'fr-FR');
  END IF;
END
$$;
