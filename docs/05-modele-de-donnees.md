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

| Table                                         | Rôle                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `calendars`, `calendar_segments`, `holidays`  | Heures ouvrées, fuseau, jours fériés fixes ou ponctuels         |
| `agreements`                                  | Engagement : nature (SLA/OLA), axe (TTO/TTR), durée, calendrier |
| `agreement_levels`, `agreement_level_actions` | Niveaux d'escalade, décalage par rapport à l'échéance           |
| `ticket_escalations`                          | Niveaux déjà déclenchés — trace et verrou anti-rejeu            |

Une seule table d'engagements plutôt que `slas` et `olas` : les deux ont exactement les mêmes
colonnes et les mêmes niveaux, seule leur portée diffère. Deux tables jumelles auraient imposé de
dupliquer chaque requête, chaque politique et chaque écran.

Les échéances vivent sur le ticket — `date_due`, `date_due_own` pour les SLA, `date_due_internal`,
`date_due_own_internal` pour les OLA — plutôt que dans une table d'état séparée : elles se trient
et se filtrent avec le ticket, et une jointure supplémentaire sur la requête la plus fréquente de
l'outil ne se justifierait pas.

Elles sont **calculées et stockées**, puis recalculées à chaque événement pertinent (changement
d'engagement, suspension, reprise). Les recalculer à la lecture rendrait toute liste triée par
échéance inexploitable. Le recalcul repart toujours de la date d'ouverture : voir
[07](07-niveaux-de-service-et-regles.md).

## Règles et gabarits

`rules` (collection, rang, actif, toutes ou une condition, arrêt après), `rule_criteria`
(champ, opérateur, valeur), `rule_actions` (champ, type d'action, valeur), `ticket_templates`,
`ticket_template_fields` (prédéfini, obligatoire, masqué), `recurrent_tickets`.

Le champ nommé par un critère ou une action est une **clé de catalogue**, jamais un nom de
colonne : c'est ce qui empêche une règle d'écrire n'importe où. Voir
[07](07-niveaux-de-service-et-regles.md).

## Notifications et courriel

`notification_templates` (événement, actif, entité, récursif),
`notification_template_translations` (langue, sujet, corps texte, corps HTML),
`notification_template_targets` (rôle, adresse pour le rôle `fixed`),
`notification_queue` (état, tentatives, erreur, **identifiant du message envoyé**),
`notification_preferences` (utilisateur, événement, actif),
`mail_collectors`, `mail_collector_logs`.

`notification_queue.message_id` n'est pas une commodité : c'est lui qui rattache une réponse au bon
ticket, là où un sujet peut avoir été réécrit, traduit ou tronqué. Voir [08](08-communication.md).

## Satisfaction

`satisfaction_configs` (taux, délai, validité, relance — configuration, donc héritable) et
`satisfactions` (une par ticket, jeton du lien public, dates d'envoi, de relance et de réponse,
note, commentaire).

Le jeton est unique et fait autorisation : il ouvre l'accès à une seule enquête, à quelqu'un qui n'a
pas de compte.

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

## Connaissance et formulaires

`kb_categories` (arborescentes), `kb_articles` (titre, contenu, catégorie, **FAQ publique**,
brouillon, compteur de consultations, version), `kb_article_revisions` (état précédent, entier),
`kb_article_targets` (profil, groupe ou utilisateur — aucune cible signifiant « tout le périmètre »),
`kb_favorites`.

`forms`, `form_sections`, `form_questions`, `form_question_conditions` (question dont dépend
l'affichage, opérateur, valeur), `form_translations`, `form_access`, `form_destinations`
(correspondances champ de l'objet vers question ou valeur fixe), `form_submissions` (réponses
complètes, conservées même quand aucune correspondance ne les reprend).

Les conditions et les correspondances désignent une question par son **rang** dans le formulaire,
jamais par un identifiant : voir [09](09-self-service.md).

## Pilotage

| Table               | Rôle                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `recurring_tickets` | Gabarit plus calendrier de génération                            |
| `recurrence_runs`   | Trace des occurrences produites : index unique anti-rejeu        |
| `unavailabilities`  | Absences d'un technicien, superposées au planning                |
| `dashboards`        | Tableaux de bord, personnels ou partagés                         |
| `dashboard_widgets` | Composition ordonnée, configuration en JSON                      |

Le planning ne crée pas de table : `itil_tasks` porte ses bornes et son technicien depuis le premier
jour. Les indisponibilités vivent à côté parce qu'une absence n'a ni objet porteur ni durée facturée.

## Recherche plein texte

Colonne `search_vector tsvector` **générée** — pas alimentée par un déclencheur — indexée en GIN.
En place sur `kb_articles`, où le titre pèse plus que le corps ; à venir sur `tickets`, `problems`,
`changes` et `itil_followups`.

Générée plutôt que déclenchée : la base garantit alors qu'elle est toujours à jour, y compris pour
une écriture faite hors de l'application.

## Points d'extension non implémentés

Identifiés maintenant pour ne pas se piéger, activés seulement si la volumétrie l'impose :
partitionnement de `tickets` et `logs` par année, index de recherche externe derrière l'interface
existante, et archivage des tickets clos au-delà d'une ancienneté configurable.
