# Niveaux de service et moteur de règles

Deux mécanismes traités ensemble parce qu'ils ne servent à rien l'un sans l'autre : les règles
décident quel engagement s'applique, l'engagement donne aux règles quelque chose à décider.

## 1. Le temps ouvré

### Pourquoi un fuseau explicite

Un calendrier porte des **heures murales** : « 8 h – 18 h » veut dire 8 h sur place. Les
interpréter dans le fuseau du serveur rendrait une échéance dépendante de la machine, et la
déplacerait de deux heures au passage à l'heure d'été — sans que rien ne le signale. Chaque
calendrier porte donc son fuseau IANA, vérifié à l'enregistrement contre les fuseaux connus
d'ICU.

L'arithmétique vit dans [`working-time.ts`](../apps/api/src/slm/working-time.ts), sans dépendance :
tout se ramène à deux opérations — convertir un instant en heure murale et l'inverse — et les
fonctions restent pures, donc testables sans base ni horloge.

```
addWorkingSeconds(calendrier, depuis, secondes)      → instant
subtractWorkingSeconds(calendrier, depuis, secondes) → instant
workingSecondsBetween(calendrier, debut, fin)        → secondes
```

Trois points d'attention, chacun couvert par un test :

- **Les plages qui se chevauchent sont fusionnées.** « 8 h – 12 h » et « 11 h – 18 h » saisies
  ensemble compteraient sinon une heure deux fois, et l'échéance tomberait trop tôt.
- **Le changement d'heure ne fait pas dériver.** Le retour à l'instant passe par l'heure murale
  reconstruite, pas par une addition de millisecondes sur le début de journée.
- **Un calendrier sans aucune plage ne fait pas boucler.** La recherche est bornée à dix ans et
  échoue bruyamment plutôt que de tourner sans fin.

Un engagement **sans calendrier** compte en temps calendaire. Ce n'est pas une configuration
incomplète : « 4 heures, 24/7 » est un engagement parfaitement légitime.

### Jours fériés perpétuels

`is_perpetual` distingue un jour qui revient chaque année à la même date — le 1er janvier — d'une
fermeture ponctuelle. Sans cette distinction, il faudrait ressaisir les fériés fixes tous les ans,
et les oublier fausserait silencieusement toutes les échéances de mai.

## 2. Les engagements

### Un engagement, un axe

Un engagement porte sur **un seul axe** : `tto` (prise en compte) ou `ttr` (résolution). Les deux
se paramètrent séparément parce qu'ils se mesurent séparément et s'escaladent séparément.

`kind` distingue le **SLA**, opposable au demandeur, de l'**OLA**, interne aux équipes. Le ticket
porte donc quatre références et quatre échéances :

| Référence    | Échéance                | Sens                                 |
| ------------ | ----------------------- | ------------------------------------ |
| `sla_tto_id` | `date_due_own`          | prise en compte promise au demandeur |
| `sla_ttr_id` | `date_due`              | résolution promise au demandeur      |
| `ola_tto_id` | `date_due_own_internal` | prise en compte visée en interne     |
| `ola_ttr_id` | `date_due_internal`     | résolution visée en interne          |

Confondre les deux niveaux reviendrait à n'avoir qu'un seul engagement : c'est précisément l'écart
entre l'échéance interne et l'échéance opposable qui laisse à l'équipe une marge de rattrapage.

### Recalcul, jamais décalage

Les échéances sont **recalculées** depuis la date d'ouverture :

```
echeance = addWorkingSeconds(calendrier, date_opened, duree + temps_attente_cumule)
```

Un calcul incrémental — décaler l'échéance à chaque suspension — dériverait au fil des allers-retours
entre « en attente » et « en cours », et deux tickets identiques finiraient avec des échéances
différentes selon leur historique de statuts. Le recalcul est idempotent : le rejouer ne change rien.

Le temps passé en attente **s'ajoute à la durée de l'engagement**. Il ne se retranche pas du délai
constaté : le délai décrit ce qui s'est passé, l'échéance ce qui était promis.

### Escalade

Un niveau se déclenche à un décalage **relatif à l'échéance** : négatif avant, positif après.
Exprimer les rappels par rapport à l'échéance plutôt qu'à l'ouverture les rend justes quel que soit
l'engagement appliqué. Le décalage se compte lui aussi en temps ouvré — « deux heures avant
l'échéance » un lundi matin ne doit pas tomber le dimanche, où personne ne le verra.

Le déclenchement est piloté par la base, pas par une minuterie en mémoire :

- `tickets.escalation_level_id` et `tickets.escalation_at` désignent **le prochain** niveau dû,
  choisi parmi les quatre engagements, en excluant les axes déjà satisfaits et les niveaux déjà
  joués ;
- une tâche répétable balaie `escalation_at <= now()` toutes les minutes, sur un index dédié ;
- `ticket_escalations` garde la trace de ce qui a été exécuté.

Cette trace n'est pas un journal : c'est un **verrou**. Elle est écrite avant les actions, et son
insertion en conflit fait renoncer le second balayage. Sans elle, un redémarrage rejouerait toutes
les escalades passées, et un ticket en retard depuis une semaine réaffecterait son groupe à chaque
cycle. Un seul niveau est planifié à la fois, et il est réévalué après chaque exécution : décaler
une échéance laisserait sinon derrière elle des escalades programmées sur l'ancienne date.

Un ticket clos n'est jamais escaladé : cela n'aurait aucun destinataire utile et rouvrirait une
conversation terminée.

## 3. Le moteur de règles

### Collections

Un seul moteur, plusieurs points d'application. Les séparer par collection évite d'évaluer des
règles de tickets pendant une synchronisation d'annuaire, et rend explicite le catalogue de champs
disponible à chaque endroit.

| Collection             | Quand                              | Décide                                |
| ---------------------- | ---------------------------------- | ------------------------------------- |
| `dictionary.ticket`    | avant tout le reste, à la création | réécrit le texte                      |
| `ticket.create`        | à la création                      | catégorie, urgence, acteurs, SLA, OLA |
| `ticket.update`        | à la modification                  | idem, sur l'état résultant            |
| `authorization.assign` | à l'ouverture de session LDAP      | profil, entité, récursivité           |
| `entity.assign`        | à l'ouverture de session LDAP      | entité de rattachement                |

### Un catalogue, pas des noms de colonnes

Comme pour la recherche, l'utilisateur nomme une **clé**, jamais une colonne. Le
[catalogue](../apps/api/src/rules/rule-catalog.service.ts) déclare, par collection, les champs
utilisables en critère (avec leurs opérateurs) et en action (avec leurs types d'action). Sans lui,
une action « affecter » serait une écriture arbitraire en base.

Un critère ou une action inexprimable est **refusé à l'enregistrement**, pas ignoré à l'exécution :
une règle qui ne se déclenche jamais parce qu'un critère est invalide rassure l'administrateur et
ne fait rien — c'est le pire des deux mondes.

Les plugins peuvent enrichir le catalogue : un champ ajouté au ticket par un plugin doit pouvoir
servir dans les règles, sinon il reste décoratif.

### Ordre et chaînage

L'ordre est la moitié du sens d'une collection : deux règles qui décident du même champ ne se
distinguent que par leur rang. Le rang progresse par pas de dix, ce qui permet d'intercaler une
règle sans renuméroter la collection.

Pour les tickets, les règles **s'enchaînent** : les critères d'une règle voient ce que les
précédentes ont décidé. C'est ce qui permet de normaliser une catégorie puis d'en déduire un
groupe. `stop_after` interrompt la collection — sans quoi une règle générale placée en fin de liste
écraserait systématiquement les décisions des précédentes.

Pour les habilitations, le chaînage est **coupé** : chaque règle produit une décision indépendante,
et un utilisateur membre de deux groupes reçoit deux habilitations. Sans cette isolation, la
deuxième règle verrait le profil posé par la première et ne s'appliquerait plus.

Une règle **sans critère** s'applique toujours : c'est la façon d'exprimer une valeur par défaut.

### Expressions régulières

Les captures d'un critère `regex` sont mémorisées **par champ** et réutilisables par une action
`regex_result` du même champ, via `#0` à `#9`. C'est le seul moyen d'extraire un numéro de dossier
d'un objet de courriel. Une référence sans capture correspondante devient vide plutôt qu'un `#3`
littéral, plus déroutant encore dans un titre de ticket.

Les expressions sont écrites par des administrateurs, mais s'exécutent sur chaque ticket créé.
Node ne sait pas interrompre une évaluation trop longue : la longueur du motif est donc bornée, et
un motif invalide est ignoré avec un avertissement plutôt que de faire échouer une création.

### Le simulateur

`POST /api/rules/simulate` rejoue une collection **sans rien écrire**, et rend pour chaque règle :
son verdict, le verdict de chaque critère avec la valeur réellement lue, et les champs modifiés.

Le simulateur appelle le moteur de production, pas une copie. Une seconde implémentation
« d'aperçu » finirait par diverger, et la réponse à « pourquoi ce ticket a-t-il été affecté là »
cesserait d'être vraie sans prévenir.

### Ce que les règles ont remplacé

La table `ldap_group_mappings` du jalon J1 a disparu. La collection `authorization.assign` fait la
même chose en plus expressif : une organisation peut décider sur le service, sur le domaine du
courriel, ou sur une expression appliquée au nom distingué, là où une table de correspondance ne
savait comparer qu'un groupe.

**Le mécanisme de révocation, lui, est inchangé.** Les habilitations produites restent marquées
`is_dynamic`, et la réconciliation reste celle de J1 : une habilitation dynamique disparue des
règles est retirée, une habilitation saisie à la main n'est jamais touchée.

## 4. Un piège de visibilité à connaître

Un objet de configuration hérité vit sur un **ancêtre**, donc hors du périmètre descendant. Une
jointure sur `entities` dans une requête soumise au Row-Level Security fait alors disparaître la
ligne entière — pas seulement le nom de l'entité :

```sql
-- Faux : un calendrier défini à la racine devient invisible depuis une filiale.
SELECT c.*, e.name FROM calendars c JOIN entities e ON e.id = c.entity_id
```

La politique du calendrier l'autorisait pourtant. C'est la jointure qui l'élimine, sans erreur ni
trace, et l'échéance qu'il portait est silencieusement ignorée.

Le nom de l'entité est donc résolu **à part**, avec le rôle propriétaire, par
[`entityNames`](../apps/api/src/common/entity-names.ts). Même forme que la résolution de
configuration décrite dans [03](03-entites-droits-securite.md) : la visibilité est tranchée par la
politique de l'objet, l'étape suivante ne fait que nommer ce qui a déjà été autorisé.

Le même défaut existait sur les gabarits de ticket depuis J3 ; il est corrigé de la même manière.

## 5. Ordre d'application à la création d'un ticket

1. **Gabarit** — valeurs préremplies, champs obligatoires vérifiés.
2. **Dictionnaire** — le texte est normalisé, pour que les critères suivants portent sur un titre
   déjà nettoyé.
3. **Hooks `ticket.beforeCreate`** — règles de code, celles du développeur de plugin.
4. **Règles `ticket.create`** — configuration de l'organisation, qui a le dernier mot sur
   l'aiguillage.
5. **Priorité** — recalculée par la matrice de l'entité, sauf si une règle l'a fixée explicitement :
   forcer une priorité est une décision assumée, la matrice ne doit pas la reprendre aussitôt.
6. **Écriture, acteurs, échéances** — les échéances viennent en dernier, leur point de départ étant
   la date d'ouverture que la base vient de poser.

À la modification, les règles voient l'**état résultant** et non l'état précédent : un critère
« urgence = 5 » doit porter sur l'urgence qui va être écrite. Elles passent donc avant la validation
de transition de statut, de sorte que le statut contrôlé soit celui qui sera réellement enregistré.
