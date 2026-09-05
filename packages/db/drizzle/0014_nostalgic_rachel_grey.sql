-- La table de correspondance groupe -> habilitation disparait : la decision
-- revient desormais au moteur de regles, collection `authorization.assign`.
-- Le mecanisme de revocation, lui, est inchange — ce sont toujours les
-- habilitations `is_dynamic` qui sont reconciliees a chaque synchronisation.
DROP TABLE "ldap_group_mappings" CASCADE;