# Pilotage

Quatre briques pour la même question : où en est le service. Le **planning** dit ce qui est prévu,
les **statistiques** ce qui s'est passé, les **tableaux de bord** figent ce qu'on veut revoir, et les
**tickets récurrents** produisent ce qui revient. Les exports et les actions massives complètent la
recherche, dont ils sont le prolongement naturel.

## 1. Un agrégat est une lecture

C'est le point qui gouverne tout ce module. Compter n'est pas moins divulguer que lister : « 47
tickets ouverts au Site B » révèle exactement ce qu'une liste refusée cachait. Toutes les
agrégations passent donc par `TicketScopeService`, la même portée de droit que la liste des tickets,
en plus du Row-Level Security.

`conditionFor` accepte pour cela un **alias de table** : les agrégations joignent `tickets` sous un
nom court, et la portée doit s'exprimer sur ce nom. Le paramétrer à la source garde une seule
implémentation ; réécrire la condition après coup en aurait créé une seconde, silencieusement
divergente.

L'alias est filtré aux lettres, chiffres et soulignés avant interpolation. Il vient du code, jamais
d'une saisie — mais une faute de frappe suffirait, et le filtre coûte une ligne.

## 2. Planning

### Tâches et indisponibilités dans une seule liste

`itil_tasks` portait déjà `begin_at`, `end_at`, `technician_id` et `group_id` depuis J2. La seule
table nouvelle est `unavailabilities` : une absence n'est pas une tâche — elle n'a ni objet porteur
ni durée facturée — et la ranger dans `itil_tasks` l'aurait fait apparaître dans la chronologie d'un
ticket qu'elle ne concerne pas.

Les deux sortent d'une **seule requête**, dans une seule liste. La vue les superpose de toute façon,
et surtout : un conflit se détecte entre une tâche et une absence aussi bien qu'entre deux tâches.

### Conflits

Un conflit n'existe qu'entre entrées **d'une même personne**. Deux techniciens occupés au même
moment, c'est une équipe qui travaille. Une tâche affectée à un groupe seulement n'entre dans aucun
conflit : personne n'est encore engagé.

Le balayage est linéaire par technicien, après le tri par date de début que la requête a déjà fait :
on ne compare qu'aux entrées encore ouvertes.

### Fenêtre bornée

Cent jours au maximum. Au-delà, la requête ramènerait des milliers d'entrées qu'aucune vue calendrier
n'affiche, et la détection de conflits — quadratique dans le pire cas par technicien — s'en
ressentirait.

### iCal

Sérialisation écrite ici, pas empruntée : le format tient en trois règles — repli des lignes à 75
**octets**, échappement de quatre caractères, horodatage UTC. Le repli compte en octets et non en
caractères, sans quoi un accent produit une ligne que les clients stricts refusent.

Une tâche « pour information » sort en `TRANSP:TRANSPARENT` : elle documente sans occuper la
personne, et c'est cette distinction que le client de calendrier utilise pour proposer un créneau.

Un fichier, pas un abonnement. Un flux permanent exigerait un jeton porteur dans l'URL, donc un
secret durable déposé dans le calendrier de chacun. Compromis assumé, et réversible.

## 3. Tickets récurrents

### Gabarit plus calendrier

Le gabarit porte la forme du ticket — type, catégorie, acteurs, champs obligatoires. La récurrence
porte le calendrier, le titre et la description. Les séparer permet d'utiliser le même gabarit pour
une création manuelle et pour une génération automatique.

Périodicité : trois pas — `daily`, `weekly`, `monthly` — combinés à un intervalle. « Toutes les deux
semaines » s'écrit `weekly` × 2. Une expression cron serait plus expressive et illisible pour celui
qui la configure.

### Arithmétique des occurrences

Deux pièges, tous deux traités :

- **L'heure murale doit tenir.** Une intervention prévue à 8 h reste à 8 h de part et d'autre d'un
  changement d'heure. Le décalage se fait donc sur la date civile dans le fuseau du calendrier de
  l'entité, pas en ajoutant des millisecondes. Les primitives sont celles du temps ouvré
  (`zonedParts`, `instantFromZoned`), exportées plutôt que réécrites : deux implémentations du même
  calcul divergeraient exactement le week-end où l'écart se voit.
- **Le quantième ne doit pas dériver.** Une récurrence mensuelle posée le 31 est rabattue au 28 en
  février — la reporter au 1er mars la déplacerait de mois. Et l'occurrence est calculée **depuis le
  début**, rang par rang, jamais par pas successifs : accumuler les pas aurait laissé la récurrence
  au 28 pour toujours.

### Génération

Même dispositif que l'escalade, pour la même raison : ce qui doit survivre à un arrêt vit dans la
base. `next_occurrence_at` pilote le déclenchement, `recurrence_runs` porte un index unique
`(recurring_id, occurrence_at)` qui sert de verrou anti-rejeu.

L'**avance de création** décale le déclenchement, pas l'occurrence : un ticket d'intervention pour
lundi 8 h doit exister le vendredi, mais il reste l'occurrence de lundi.

Le ticket naît sous un contexte reconstitué, limité à **l'entité de la récurrence** — jamais sa
descendance — et avec le profil de l'auteur de la règle. Lui prêter un profil plus large ferait
produire des tickets qu'il n'aurait pas pu créer lui-même.

### Deux garde-fous appris à l'usage

- **La compatibilité du gabarit est vérifiée à l'enregistrement**, pas à la génération. Une
  récurrence dont le gabarit exige un champ qu'elle ne fournit pas échouerait toutes les semaines, à
  trois heures du matin, sans que personne ne le voie.
- **La réservation est rendue en cas d'échec.** Écrire la trace avant le ticket protège du rejeu,
  mais la laisser après une erreur perdrait l'occurrence en la marquant faite. L'échéance reste donc
  en place et le cycle suivant réessaie ; le journal nomme la cause à chaque tentative, ce qui est
  exactement la pression qu'il faut.

## 4. Statistiques

Indicateurs globaux — ouverts, résolus, clos, en cours, temps moyens de prise en compte et de
résolution, respect des engagements, satisfaction — et ventilation selon huit dimensions : entité,
catégorie, technicien, groupe, priorité, source, statut, type.

La liste des dimensions est **fermée** : chacune correspond à une expression SQL enregistrée côté
serveur. Accepter un nom de colonne arbitraire aurait transformé ce point d'entrée en interface SQL
ouverte.

Le taux de respect des engagements ne compte que les tickets qui **en ont un** et dont l'échéance est
passée ou tenue. Un ticket sans SLA ne peut ni l'honorer ni le manquer, et l'inclure ferait
mécaniquement monter le taux.

La courbe d'activité tire sa série de dates de `generate_series`, pas des tickets : sans elle, un
jour sans activité disparaîtrait et la courbe relierait deux points distants en laissant croire à
une activité continue.

## 5. Tableaux de bord

Un tableau de bord est une liste de widgets ordonnés, rien de plus. La configuration de chaque
widget est en JSON parce que les plugins en déclarent, dont le cœur ne peut pas connaître les champs
à l'avance.

Le registre de widgets fonctionne comme celui des champs de recherche, et pour la même raison : ce
qu'un tableau enregistre est une **clé**, pas du code. Un widget dont le plugin est désactivé
disparaît de l'affichage, mais sa ligne survit — réactiver le plugin fait revenir le contenu, là où
une suppression en cascade aurait perdu la composition.

Un tableau est personnel par défaut ; le rendre public est une décision explicite. Seul son
propriétaire peut le modifier : partager une vue n'est pas en confier la composition.

Côté interface, **chaque widget pose sa propre requête**. Faire descendre un rapport unique depuis
la page aurait été plus économe et aurait rendu la configuration inopérante : deux widgets
« répartition » sur deux dimensions différentes auraient affiché la même chose.

## 6. Exports

CSV et PDF, écrits sans dépendance.

Le CSV suit le RFC 4180, avec une précaution de plus : une valeur commençant par `=`, `+`, `-` ou
`@` est préfixée d'une apostrophe. Sans cela, un titre de ticket commençant par `=` devient une
formule dans le tableur qui l'ouvre — c'est un vecteur d'injection connu, et il passe par un champ
que n'importe qui peut remplir. Le fichier commence par une marque d'ordre des octets, sans laquelle
Excel lit les accents de travers.

Le PDF est réduit à un tableau en Helvetica : un objet par page, plus une table de références
croisées. Une bibliothèque de génération pèse plusieurs mégaoctets et suit son propre calendrier de
sécurité, pour un besoin qui ne dépasse pas le tableau imprimable. Deux détails y sont critiques :
les parenthèses sont échappées — non échappées, elles cassent le document entier, et les lecteurs
affichent une page blanche sans rien dire — et les positions de la table de références sont
calculées en octets `latin1`, le texte ayant été réduit au jeu WinAnsi que la police de base 14
sait rendre.

L'export reprend **la requête de recherche courante**, pas un filtre distinct : il doit rendre
exactement ce que l'écran montre.

## 7. Actions massives

Chaque ticket passe par le service ordinaire, un par un, dans sa propre transaction. Une mise à jour
SQL de masse serait bien plus rapide et contournerait tout ce qui fait la valeur d'une modification :
transitions vérifiées, priorité recalculée, historique, règles, échéances, notifications.

Les actions disponibles sont fermées. On y trouve **l'urgence, jamais la priorité** : celle-ci est
dérivée par la matrice de l'entité, et permettre de la forcer en masse produirait des tickets dont
la priorité contredit l'urgence affichée.

Une affectation **ajoute** un intervenant sans effacer les autres. Remplacer aurait été le
comportement le plus simple et le plus destructeur : une réaffectation massive retirerait au passage
les demandeurs, et personne ne s'en apercevrait avant la prochaine notification qui n'atteint plus
personne.

Les échecs n'interrompent pas la série et sont rendus **un par un** : « 3 tickets sur 40 ont échoué »
n'aide personne à savoir lesquels reprendre.

## 8. Isolation

| Table                                    | Nature        | Règle                                            |
| ---------------------------------------- | ------------- | ------------------------------------------------ |
| `recurring_tickets`                       | configuration | `tick_config_visible(path, false)`               |
| `recurrence_runs`                         | donnée        | portée par sa récurrence                         |
| `unavailabilities`                        | donnée        | `tick_in_scope(path)`, descendante               |
| `dashboards`                              | configuration | `tick_config_visible(path, is_recursive)`        |
| `dashboard_widgets`                       | —             | visibilité de son tableau, résolue par jointure  |

La récurrence n'a pas de drapeau récursif : elle produit des tickets dans une entité précise, et les
faire naître ailleurs que là où la règle est déclarée n'aurait pas de sens.

`dashboard_widgets` n'a pas de colonne d'entité. Lui en donner une aurait permis à un widget de
survivre au déplacement de son tableau, ce qui ne veut rien dire.

## 9. Événements

Le SDK passe en `0.7` : `recurrence.generated` publie l'identifiant de la récurrence, celui du ticket
produit et l'occurrence concernée. Les plugins gagnent aussi `dashboards.registerWidget`, sur le
modèle de `search.registerField`.
