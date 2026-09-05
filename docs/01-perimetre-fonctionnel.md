# Périmètre fonctionnel

Référence : **GLPI 11.x**, menu Assistance et tout ce qui le rend opérant (administration,
configuration, transverse). La gestion de parc, l'inventaire et la gestion financière sont
explicitement **hors périmètre**.

Chaque module porte un identifiant (`M01`…`M17`) réutilisé dans la feuille de route.

---

## M01 — Objets ITIL

Trois objets partageant un socle commun (acteurs, suivis, tâches, solution, validations,
documents, historique, notifications) :

- **Ticket** — deux types : incident et demande de service.
- **Problème** — avec causes, symptômes, impacts.
- **Changement** — avec plan de déploiement, plan de retour arrière, plan de validation, checklist.

**Liens entre objets** : duplicata, lié, parent/enfant, et promotion ticket → problème → changement
avec report des acteurs et de l'historique.

> Décision de conception : trois tables distinctes partageant un jeu de colonnes commun, et des
> tables satellites polymorphes (`itil_actors`, `itil_followups`…). Éviter la table unique
> fourre-tout, qui rendrait les index et les droits illisibles.

## M02 — Anatomie du ticket

**Champs** : titre, description, statut, type, catégorie ITIL, urgence, impact, priorité, source de
la demande, lieu, entité, dates (ouverture, échéance, prise en compte, résolution, clôture),
temps de résolution, temps interne, gabarit appliqué.

**Statuts** : nouveau, en cours (attribué), en cours (planifié), en attente, résolu, clos. Les
transitions autorisées sont configurables ; le statut « en attente » suspend le décompte SLA.

**Acteurs** — trois rôles × trois natures, un ticket pouvant en cumuler autant que nécessaire :

|             | Utilisateur | Groupe | Fournisseur |
| ----------- | ----------- | ------ | ----------- |
| Demandeur   | ✓           | ✓      | ✓           |
| Observateur | ✓           | ✓      | ✓           |
| Attribué à  | ✓           | ✓      | ✓           |

**Suivis** — contenu riche, public ou privé, source (interface, courriel, téléphone, autre), date
d'échéance facultative, auteur.

**Tâches** — description, statut (à faire / fait), catégorie de tâche, durée réelle, planification
(début, fin) sur un technicien ou un groupe, visibilité privée, rappel.

**Solution** — type de solution, contenu, et approbation facultative par le demandeur (qui peut
refuser et rouvrir le ticket).

**Validations** — demande d'approbation adressée à un utilisateur ou un groupe, avec statut
(en attente, accordée, refusée), commentaire de demande et de réponse, et blocage configurable
de la résolution tant que la validation n'est pas obtenue.

**Aussi** : documents joints, coûts (temps, fixe, matériel), historique complet de toutes les
modifications, statistiques du ticket (temps de prise en compte, de résolution, temps interne).

## M03 — Gestion des niveaux de service (SLM)

- **SLA** (engagement envers le demandeur) et **OLA** (engagement interne), chacun sur deux axes :
  temps de prise en compte (TTO) et temps de résolution (TTR).
- **Calendriers** — plages d'ouverture par jour de semaine, jours fériés récurrents ou datés.
  Le décompte n'avance que pendant les heures ouvrées du calendrier de l'entité.
- **Niveaux d'escalade** — déclenchés avant ou après échéance, avec actions automatiques
  (changer la priorité, ajouter un acteur, envoyer une notification, exécuter une action de plugin).
- **Suspension** — le passage en « en attente » gèle le compteur ; la reprise le relance.

## M04 — Moteur de règles

Un moteur générique — critères, actions, ordre d'exécution, drapeau « arrêter après » — décliné en
plusieurs collections :

- Règles sur les tickets **à la création**
- Règles sur les tickets **à la mise à jour**
- Règles d'**affectation d'habilitations** (annuaire → profil + entité)
- Règles d'**affectation d'entité** (notamment pour les tickets créés par courriel)
- **Dictionnaires** — normalisation de valeurs à l'écriture

Critères : opérateurs `est`, `n'est pas`, `contient`, `commence par`, `expression régulière`,
`existe`, `sous l'arbre de`. Actions : affecter, ajouter, retirer, calculer, refuser.
Un simulateur permet de tester une règle contre un ticket existant avant activation.

## M05 — Gabarits de tickets

Par type, catégorie, entité et profil : champs **prédéfinis** (valeur par défaut), **obligatoires**
(bloquants à l'enregistrement) et **masqués** (retirés du formulaire). Un gabarit peut également
prédéfinir des tâches et des acteurs.

## M06 — Tickets récurrents

Un gabarit plus un calendrier de génération (périodicité, date de début, date de fin, création
anticipée). Génération par tâche planifiée.

## M07 — Notifications

- **Événements** — création, mise à jour, ajout de suivi, ajout de tâche, résolution, clôture,
  validation demandée ou répondue, échéance SLA approchante, satisfaction, et tout événement
  déclaré par un plugin.
- **Modèles** multilingues avec corps texte et HTML, et jeu de variables documenté.
- **Destinataires calculés** — demandeur, observateur, technicien assigné, groupe assigné,
  superviseur du groupe, responsable hiérarchique, auteur du suivi, adresse fixe.
- **File d'attente** persistante avec réessais, traçabilité des envois et purge.
- **Préférences par utilisateur** — désactivation par événement.

## M08 — Courriel

- **Collecteur entrant** (IMAP, avec OAuth2) : création de ticket ou ajout de suivi selon
  la présence d'une référence dans le sujet ou les en-têtes, extraction des pièces jointes,
  détection des réponses automatiques et anti-boucle.
- **Envoi SMTP** avec adresse d'expédition et de réponse configurables par entité.

## M09 — Base de connaissances

Articles avec catégories arborescentes, révisions, ciblage de visibilité (entité, profil, groupe,
utilisateur), **FAQ publique** accessible sans authentification, proposition d'un article comme
solution depuis un ticket, création d'un article depuis une solution, favoris, compteur de
consultations, recherche plein texte.

## M10 — Formulaires (natifs en GLPI 11)

Constructeur de formulaires : sections, questions typées (texte, texte long, nombre, date, liste,
choix multiple, fichier, utilisateur, groupe, lieu, catégorie…), **logique conditionnelle**
d'affichage, traductions, **politique d'accès** (qui voit quel formulaire), aperçu, et
**destinations** — un formulaire soumis crée un ticket, un problème ou un changement avec
correspondance explicite entre réponses et champs de l'objet.

## M11 — Enquêtes de satisfaction

Déclenchement à la clôture selon un pourcentage de tickets et un délai, note et commentaire,
relance, exploitation statistique, et possibilité d'enquête externe par URL.

## M12 — Self-service

Interface simplifiée pour les demandeurs : catalogue de services (les formulaires), création
libre, suivi de ses tickets et de ceux de ses groupes, ajout de suivis, approbation de solution,
consultation de la FAQ.

## M13 — Recherche

Moteur multi-critères : champ, opérateur, valeur, combinaisons ET/OU, groupes de critères
imbriqués, critères sur objets liés. Colonnes affichées configurables, tri, pagination,
**recherches sauvegardées** (personnelles ou publiques, épinglables en page d'accueil),
exports CSV et PDF, et **actions massives** sur la sélection.

## M14 — Planning

Vue calendrier (jour, semaine, mois) des tâches planifiées et des indisponibilités, filtrable par
technicien et par groupe, avec détection des conflits et export iCal.

## M15 — Statistiques et tableaux de bord

Statistiques globales et par entité, catégorie, technicien, groupe, priorité, source :
nombres ouverts, résolus et clos, temps moyens de prise en compte et de résolution, respect des
SLA, satisfaction. Tableaux de bord composables à partir de widgets, extensibles par plugin.

## M16 — Administration

Entités, utilisateurs, groupes, profils et droits, habilitations, annuaires LDAP et
synchronisation, notifications, configuration générale et par entité, tâches automatiques,
journaux applicatifs, maintenance, gestion des plugins.

## M17 — Transverse

API REST documentée en OpenAPI, internationalisation français et anglais, thème clair et sombre,
historique universel, gestion documentaire avec types de documents, tâches planifiées,
accessibilité, et journalisation structurée.
