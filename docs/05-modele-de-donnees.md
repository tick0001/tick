# Modèle de données

Vue d'ensemble des tables du cœur. Le détail des colonnes vit dans `packages/db`, seule source de
vérité ; ce document donne la structure et les intentions.

## Conventions

- Noms de tables au pluriel, en anglais, en `snake_case`. L'anglais dans le code et le schéma,
  le français dans l'interface et la documentation.
- Clés primaires `bigint GENERATED ALWAYS AS IDENTITY`.
- `created_at`, `updated_at`, `deleted_at` sur tout objet métier. **Suppression logique**
  systématique sur les objets ITIL : GLPI a une corbeille, et l'audit l'exige.
- Toute table portant `entity_id` porte aussi `entity_path ltree`, maintenue par déclencheur.
- Les tables de configuration hiérarchisables portent `is_recursive boolean NOT NULL DEFAULT false`.

## Socle organisationnel

| Table              | Rôle                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `entities`         | Arbre des entités (`parent_id`, `path` ltree)                              |
| `entity_settings`  | Configuration par entité, `NULL` signifiant « hériter du parent »          |
| `users`            | Comptes, locaux ou issus de l'annuaire                                     |
| `groups`           | Groupes arborescents, avec superviseur et indicateurs demandeur/assignable |
| `group_users`      | Appartenances, avec rôle de responsable                                    |
| `profiles`         | Profils (Self-service, Technicien, Superviseur, Administrateur…)           |
| `profile_rights`   | Droits : objet × action × portée                                           |
| `authorizations`   | Habilitations `(utilisateur, profil, entité, récursif, dynamique)`         |
| `ldap_directories` | Annuaires configurés et paramètres de synchronisation                      |
| `sessions`         | Sessions actives et jetons de rafraîchissement révocables                  |

## Objets ITIL

| Table              | Rôle                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `tickets`          | Incidents et demandes                                                    |
| `problems`         | Problèmes                                                                |
| `changes`          | Changements                                                              |
| `itil_actors`      | Acteurs, polymorphe : `(itil_type, itil_id, role, actor_type, actor_id)` |
| `itil_followups`   | Suivis, avec visibilité privée et source                                 |
| `itil_tasks`       | Tâches, avec planification et durée                                      |
| `itil_solutions`   | Solutions, avec type et statut d'approbation                             |
| `itil_validations` | Demandes d'approbation et réponses                                       |
| `itil_costs`       | Coûts                                                                    |
| `itil_links`       | Liens entre objets : duplicata, lié, parent/enfant                       |
| `itil_documents`   | Rattachement de documents                                                |

Le triplet `(itil_type, itil_id)` est indexé sur chaque satellite. Les trois objets principaux
partagent délibérément le même jeu de colonnes communes, ce qui permet un service générique sans
sacrifier les index propres à chacun.

## Référentiels ITIL

`itil_categories` (arbre), `ticket_types`, `request_sources`, `task_categories`,
`solution_types`, `locations` (arbre), `suppliers`, `contracts` — tous rattachés à une entité et
porteurs de `is_recursive`.

## Niveaux de service

| Table                                        | Rôle                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `calendars`, `calendar_segments`, `holidays` | Heures ouvrées et jours fériés                                       |
| `slas`, `olas`                               | Engagements, type (prise en compte ou résolution), durée, calendrier |
| `sla_levels`, `sla_level_actions`            | Niveaux d'escalade et actions associées                              |
| `itil_sla_state`                             | Échéances calculées et cumul des périodes de suspension              |

Les échéances sont **calculées et stockées**, puis recalculées à chaque événement pertinent
(changement de SLA, suspension, reprise). Les recalculer à la lecture rendrait toute liste triée
par échéance inexploitable.

## Règles et gabarits

`rules` (collection, ordre, actif, arrêt après), `rule_criteria`, `rule_actions`,
`ticket_templates`, `template_fields` (prédéfini, obligatoire, masqué), `recurrent_tickets`.

## Notifications et courriel

`notifications` (événement, actif), `notification_templates`,
`notification_template_translations` (langue, sujet, corps texte, corps HTML),
`notification_targets`, `notification_queue` (état, tentatives, erreur),
`user_notification_preferences`, `mail_collectors`, `mail_collector_logs`.

## Connaissance, formulaires, satisfaction

`kb_categories` (arbre), `kb_items`, `kb_item_revisions`, `kb_item_targets` (ciblage de
visibilité), `kb_item_feedback`.

`forms`, `form_sections`, `form_questions`, `form_conditions`, `form_access_policies`,
`form_destinations`, `form_submissions`, `form_answers`.

`satisfaction_configs`, `satisfaction_surveys`.

## Transverse

| Table                             | Rôle                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| `documents`, `document_types`     | Fichiers et types autorisés                                              |
| `logs`                            | Historique universel : objet, champ, ancienne et nouvelle valeur, auteur |
| `saved_searches`                  | Recherches sauvegardées, personnelles ou publiques                       |
| `dashboards`, `dashboard_widgets` | Tableaux de bord composables                                             |
| `plugins`                         | Plugins installés : version, état, date                                  |
| `jobs`                            | Traçabilité des tâches planifiées                                        |

## Recherche plein texte

Colonne `search_vector tsvector` générée sur `tickets`, `problems`, `changes`, `kb_items` et
`itil_followups`, indexée en GIN. Configuration linguistique choisie selon la langue du contenu.

## Points d'extension non implémentés

Identifiés maintenant pour ne pas se piéger, activés seulement si la volumétrie l'impose :
partitionnement de `tickets` et `logs` par année, index de recherche externe derrière l'interface
existante, et archivage des tickets clos au-delà d'une ancienneté configurable.
