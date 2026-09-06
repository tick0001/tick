# Administration

Comptes, groupes, profils et droits. Ce document décrit le module `M16` et,
d'abord, pourquoi il a manqué si longtemps.

## 1. Ce qui manquait, et pourquoi

Le jalon J1 était marqué `M16 — Administration`. C'était une erreur de
comptabilité. Il a livré le **substrat** :

- l'arbre des entités en `ltree` et le Row-Level Security,
- les tables `users`, `groups`, `profiles`, `profile_rights`, `authorizations`,
- la résolution des droits (`RightsService`) et sa garde,
- l'annuaire LDAP et la synchronisation des habilitations dynamiques.

Tout cela est vérifié par des tests d'intégration contre une vraie base. Mais
aucun **écran** n'avait été écrit, et aucune **route** hors `entities`. Un
administrateur pouvait donc lister les entités, et rien d'autre : ni créer un
compte, ni composer un profil, ni accorder une habilitation. La seule façon de
le faire était de rejouer la graine, ou d'ouvrir `psql`.

Le tableau au moment du constat :

| Objet | Base + RLS | Route | Écran |
| ------------------ | ---------- | -------------- | -------------- |
| Entités | ✅ | CRUD complet | liste seule |
| Utilisateurs | ✅ | — | — |
| Groupes | ✅ | — | — |
| Profils et droits | ✅ | — | — |
| Habilitations | ✅ | — | — |

## 2. Ce que le modèle impose

Trois propriétés du modèle expliquent la forme des écrans.

**Le profil ne porte pas d'entité.** C'est un jeu de droits nommé, réutilisable.
Ce qui le rattache à une entité, c'est l'**habilitation** — le quadruplet
(utilisateur, profil, entité, récursif). C'est ce cumul qui permet d'être
technicien sur une branche et simple demandeur sur une autre, et donc ce qui rend
le produit multi-organisation. L'écran des profils n'a par conséquent aucun
sélecteur d'entité ; celui des comptes en a un, par habilitation.

**`users`, `profiles` et `profile_rights` n'ont pas de RLS.** Ce sont des tables
de référence globales. Leur accès est gardé par le **droit** au contrôleur, et
par rien d'autre — d'où l'importance que `user:*` et `profile:*` ne soient
accordés qu'à un profil d'administration. Les habilitations et les groupes, eux,
sont protégés par le RLS : un administrateur de filiale ne voit ni n'accorde hors
de son périmètre.

**Un compte sans habilitation ne peut pas se connecter.** C'est l'erreur qu'on
commet une fois. L'écran la signale explicitement plutôt que de la laisser
déduire d'une liste vide.

## 3. Matrice de droits

Un droit est un triplet **objet × action × portée**. L'absence de ligne vaut
refus : aucune permission n'est implicite.

L'écran présente la matrice groupée par domaine — Assistance, Connaissance,
Configuration, Administration — avec la portée en valeur d'une liste déroulante.
« Refusé » y est une valeur explicite plutôt qu'une case décochée : l'absence de
droit est une décision, et la rendre visible évite de croire qu'on a oublié de la
prendre.

### Le catalogue vient du serveur

`RIGHT_CATALOGUE` est une liste explicite, et non une déduction de ce que le code
exige. Un droit absent du catalogue serait invisible dans l'écran, donc
impossible à accorder — et l'écran qu'il protège, inatteignable. Un test
d'intégration compare la liste aux droits que les contrôleurs exigent
réellement.

Il est servi par le serveur, avec ses libellés traduits, parce que **les plugins
en déclarent** : une liste figée côté interface rendrait leurs droits
inconfigurables.

### Les portées sont restreintes par objet

| Nature | Portées proposées |
| --------------------- | ------------------------------------------ |
| Objets ITIL | `own`, `group`, `entity`, `recursive`, `all` |
| Objets de configuration | `entity`, `recursive`, `all` |

Un modèle de notification n'appartient à personne : lui proposer « les miens »
enverrait l'administrateur chercher un quart d'heure pourquoi le choix ne change
rien.

### Invalidation du cache

`RightsService` garde les droits d'un profil en mémoire. Enregistrer la matrice
invalide ce cache — sans quoi un droit retiré continuerait de s'appliquer jusqu'au
prochain redémarrage. C'est le genre d'écart qu'on ne constate qu'au moment où il
compte.

## 4. Garde-fous

Trois refus, tous appris de ce qu'il faudrait sinon réparer en base :

- **On ne se désactive pas soi-même.** La session en cours tomberait, et si
  c'était le dernier administrateur, l'installation resterait sans accès.
- **On ne retire pas son habilitation active.** On se couperait de l'écran qui
  permet de la rétablir.
- **On ne supprime pas un profil utilisé.** La cascade retirerait silencieusement
  leurs droits à des utilisateurs, et personne ne ferait le lien entre la panne et
  le ménage de la veille.

Les groupes sont supprimés **logiquement** : un groupe peut être acteur de tickets
clos, et l'effacer rendrait leur historique incompréhensible — « attribué à » ne
désignerait plus personne.

## 5. Ce que la revue a trouvé au passage

Les droits `planning:read`, `planning:update`, `recurrence:*` et `stats:read`
étaient distribués par la graine et **vérifiés par personne** : les contrôleurs
correspondants se contentaient du droit sur les tickets. Un profil sans
`planning:read` accédait donc au planning. Les gardes sont désormais posées.

Les tests d'intégration laissaient aussi derrière eux leurs profils et leurs
comptes, qui s'accumulaient à chaque exécution — visible dès que l'écran
d'administration a existé. Le nettoyage des fixtures s'en charge.

## 6. Ce qui reste hors périmètre

La gestion des annuaires LDAP a une API et une synchronisation, mais pas encore
d'écran : leur configuration reste dans la graine. Idem pour la configuration
générale par entité, exposée en lecture seule par `GET /entities/:id/settings`.
Ces deux points relèvent de J9.
