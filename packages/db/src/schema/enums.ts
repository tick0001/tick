import { pgEnum } from 'drizzle-orm/pg-core';

/** Origine du compte : saisi localement ou issu d'un annuaire. */
export const authSourceEnum = pgEnum('auth_source', ['local', 'ldap']);

/** Interface presentee a l'utilisateur selon son profil actif. */
export const profileInterfaceEnum = pgEnum('profile_interface', ['standard', 'self_service']);

/**
 * Portee d'un droit. Un droit n'est jamais un simple booleen : il se combine
 * toujours avec l'entite active du contexte de travail.
 *
 *  own       - les objets dont l'utilisateur est demandeur ou auteur
 *  group     - ceux de ses groupes
 *  entity    - ceux de l'entite active
 *  recursive - ceux de l'entite active et de sa descendance
 *  all       - tous, dans le perimetre d'habilitation
 */
export const rightScopeEnum = pgEnum('right_scope', ['own', 'group', 'entity', 'recursive', 'all']);

/**
 * Strategie de decouverte des groupes d'un utilisateur dans un annuaire.
 * Voir `ldapDirectories.groupSearchMode`.
 */
export const ldapGroupSearchModeEnum = pgEnum('ldap_group_search_mode', ['attribute', 'search']);
