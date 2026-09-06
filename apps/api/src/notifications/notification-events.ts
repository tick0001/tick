import type { EventName } from '@tick/plugin-sdk';

/**
 * Événements pour lesquels un modèle de notification a un sens.
 *
 * Liste explicite plutôt que « tout ce que le bus publie » : `plugin.activated`
 * ou `entity.updated` ne concernent pas un ticket et n'ont donc pas de
 * destinataire à calculer. Un modèle enregistré sur un événement absent d'ici
 * reste évalué — c'est ainsi qu'un plugin peut déclarer le sien — mais il
 * n'apparaît pas dans la liste proposée à la création.
 */
export const NOTIFIABLE_EVENTS = [
  { name: 'ticket.created', labelKey: 'notifications.evenements.ticketCreated' },
  { name: 'ticket.updated', labelKey: 'notifications.evenements.ticketUpdated' },
  { name: 'ticket.statusChanged', labelKey: 'notifications.evenements.ticketStatusChanged' },
  { name: 'ticket.solved', labelKey: 'notifications.evenements.ticketSolved' },
  { name: 'ticket.closed', labelKey: 'notifications.evenements.ticketClosed' },
  { name: 'ticket.escalated', labelKey: 'notifications.evenements.ticketEscalated' },
  { name: 'followup.added', labelKey: 'notifications.evenements.followupAdded' },
  { name: 'task.added', labelKey: 'notifications.evenements.taskAdded' },
  { name: 'solution.proposed', labelKey: 'notifications.evenements.solutionProposed' },
  { name: 'solution.answered', labelKey: 'notifications.evenements.solutionAnswered' },
  { name: 'validation.requested', labelKey: 'notifications.evenements.validationRequested' },
  { name: 'validation.answered', labelKey: 'notifications.evenements.validationAnswered' },
  { name: 'satisfaction.requested', labelKey: 'notifications.evenements.satisfactionRequested' },
  { name: 'satisfaction.answered', labelKey: 'notifications.evenements.satisfactionAnswered' },
] as const satisfies readonly { name: EventName; labelKey: string }[];

export type NotifiableEvent = (typeof NOTIFIABLE_EVENTS)[number]['name'];

/**
 * Variables disponibles dans un modèle, au-delà de celles de l'événement.
 *
 * Documentées ici parce que l'éditeur de modèles les propose : demander à
 * l'administrateur de deviner `{{ ticket.url }}` serait le condamner à
 * l'essai-erreur, avec un aller-retour par tentative.
 */
export const TEMPLATE_VARIABLES = [
  'ticket.id',
  'ticket.name',
  'ticket.status',
  'ticket.url',
  'evenement',
] as const;

/**
 * Rôles qui désignent des intervenants, par opposition au demandeur.
 *
 * Un suivi ou une tâche privé ne doit atteindre qu'eux : c'est la raison d'être
 * du drapeau « privé », et le trahir dans une notification annulerait la
 * confidentialité que l'interface promet.
 */
export const ROLES_INTERNES: readonly string[] = [
  'assigned',
  'assigned_group',
  'assigned_group_manager',
  'author',
  'followup_author',
  'fixed',
];
