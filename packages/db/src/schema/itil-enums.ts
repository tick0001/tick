import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Objets ITIL partageant le socle commun : acteurs, suivis, taches, solution,
 * validations, couts, documents, historique.
 *
 * Les tables satellites sont polymorphes sur ce type. Trois tables principales
 * distinctes plutot qu'une table unique : les index et les droits de chacune
 * different, et les melanger les rendrait illisibles.
 */
export const itilTypeEnum = pgEnum('itil_type', ['ticket', 'problem', 'change']);

/** Un ticket est un incident ou une demande de service. */
export const ticketTypeEnum = pgEnum('ticket_type', ['incident', 'request']);

/**
 * Statuts, calques sur ceux de GLPI.
 *
 *  new      - cree, pas encore pris en charge
 *  assigned - en cours, attribue a un technicien ou un groupe
 *  planned  - en cours, avec une tache planifiee
 *  waiting  - en attente : ce statut **suspend le decompte des delais**
 *  solved   - resolu, en attente de confirmation ou de cloture automatique
 *  closed   - clos, ferme aux modifications ordinaires
 */
export const itilStatusEnum = pgEnum('itil_status', [
  'new',
  'assigned',
  'planned',
  'waiting',
  'solved',
  'closed',
]);

/** Role d'un acteur sur un objet ITIL. */
export const actorRoleEnum = pgEnum('actor_role', ['requester', 'observer', 'assigned']);

/**
 * Nature d'un acteur.
 *
 * Les trois roles se combinent avec les trois natures : un fournisseur peut
 * etre demandeur, un groupe peut etre observateur. C'est cette matrice complete
 * qui distingue un outil ITSM d'un simple gestionnaire de tickets.
 */
export const actorTypeEnum = pgEnum('actor_type', ['user', 'group', 'supplier']);

/** Origine d'un suivi. */
export const followupSourceEnum = pgEnum('followup_source', [
  'interface',
  'email',
  'phone',
  'other',
]);

/** Etat d'une tache. `information` ne demande aucune action, elle documente. */
export const taskStateEnum = pgEnum('task_state', ['information', 'todo', 'done']);

/** Etat d'une demande de validation. */
export const validationStateEnum = pgEnum('validation_state', ['waiting', 'granted', 'refused']);

/**
 * Etat d'une solution.
 *
 * Une solution proposee attend l'approbation du demandeur, qui peut la refuser
 * et rouvrir le ticket. Conserver l'historique des solutions successives, plutot
 * qu'un champ unique ecrase, permet de savoir ce qui a ete tente.
 */
export const solutionStateEnum = pgEnum('solution_state', ['proposed', 'accepted', 'refused']);

/** Nature du lien entre deux objets ITIL. */
export const itilLinkTypeEnum = pgEnum('itil_link_type', ['linked', 'duplicate', 'child']);

/** Nature d'un champ de gabarit. */
export const templateFieldKindEnum = pgEnum('template_field_kind', [
  'predefined',
  'mandatory',
  'hidden',
]);
