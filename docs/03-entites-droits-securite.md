# Entités, droits et sécurité

C'est le cœur du modèle. Tout le reste en découle : un objet mal rattaché ou un droit mal résolu
donne une fuite de données entre organisations.

## 1. L'arbre des entités

Une hiérarchie unique, racine comprise.

```
Racine
├── Siège
│   ├── DSI
│   └── RH
└── Filiale Nord
    ├── Site A
    └── Site B
```

Représentation : `parent_id` pour la structure logique, et un **chemin matérialisé `ltree`** pour
les requêtes.

```sql
CREATE TABLE entities (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  parent_id   bigint REFERENCES entities(id),
  path        ltree NOT NULL,          -- ex. 'racine.filiale_nord.site_a'
  name        text  NOT NULL,
  ...
);
CREATE INDEX ON entities USING gist (path);
```

`path <@ 'racine.filiale_nord'` retourne une entité et toute sa descendance en une comparaison
indexée. GLPI maintient pour cela des caches d'ancêtres et de descendants qu'il faut invalider à
chaque déplacement ; ici un déplacement de sous-arbre est une seule mise à jour de préfixe.

## 2. Rattachement des objets

Chaque objet porte `entity_id`. **Un ticket appartient à exactement une entité**, et ce
rattachement est décidé à la création (saisie, gabarit, ou règle d'affectation d'entité).

Chaque table concernée porte aussi une colonne dénormalisée `entity_path ltree`, maintenue par
déclencheur depuis `entities`. Elle sert uniquement à rendre les politiques RLS indexables sans
sous-requête. C'est une dénormalisation assumée et documentée.

## 3. Deux natures d'objets, deux règles de visibilité

C'est le point le plus souvent mal compris de GLPI, alors il est posé explicitement ici.

### Objets de données — visibilité descendante

Tickets, problèmes, changements, suivis, tâches, documents. Ils appartiennent à une entité et sont
vus depuis cette entité **ou depuis ses ancêtres** si l'on travaille en mode « et ses
sous-entités ». Ils ne remontent jamais tout seuls.

### Objets de configuration — visibilité ascendante conditionnée par `is_recursive`

Catégories ITIL, SLA et OLA, calendriers, gabarits, groupes, modèles de notification, articles de
base de connaissances, formulaires, règles.

Ces objets portent un drapeau **`is_recursive`** qui signifie : « défini dans l'entité E, mais
également utilisable dans toute la descendance de E ». Un SLA créé à la racine avec le drapeau est
disponible partout ; sans le drapeau, il n'existe que pour la racine.

> `is_recursive` ne s'applique **jamais** à un ticket. Un ticket n'est pas partagé, il est situé.

Concrètement, depuis l'entité `racine.filiale_nord.site_a`, les catégories visibles sont celles de
`site_a`, plus celles de `filiale_nord` et de `racine` marquées récursives.

## 4. L'habilitation est un quadruplet

Le lien entre un utilisateur et ses droits n'est pas `utilisateur → profil`. C'est :

```
(utilisateur, profil, entité, récursif)
```

```sql
CREATE TABLE authorizations (
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id   bigint NOT NULL REFERENCES profiles(id),
  entity_id    bigint NOT NULL REFERENCES entities(id),
  is_recursive boolean NOT NULL DEFAULT false,
  is_dynamic   boolean NOT NULL DEFAULT false,  -- posée par une règle LDAP, donc révocable
  PRIMARY KEY (user_id, profile_id, entity_id)
);
```

Un même utilisateur peut être **Technicien sur `Filiale Nord` et sa descendance** et
**Self-service sur `Siège`**. C'est ce cumul qui rend l'outil réellement multi-organisation, et
c'est exactement ce que la plupart des clones de GLPI simplifient à tort.

`is_dynamic` distingue les habilitations posées par une règle d'affectation depuis l'annuaire
(retirées automatiquement quand l'utilisateur quitte le groupe) de celles saisies à la main.

## 5. Contexte de travail

À la connexion, l'utilisateur obtient un **contexte** : une entité active parmi celles où il est
habilité, un profil actif, et un indicateur « inclure les sous-entités ». Il peut en changer sans
se reconnecter.

Ce contexte détermine :

- ce qu'il **voit** — le périmètre de lecture ;
- ce qu'il **crée** — un ticket créé hérite de l'entité active ;
- ce qu'il **peut faire** — les droits du profil actif, et eux seuls.

## 6. Droits, actions et portées

Un droit n'est jamais un simple booléen. C'est le triplet **objet × action × portée** :

| Portée | Signification |
|---|---|
| `own` | Les objets dont l'utilisateur est demandeur ou auteur |
| `group` | Ceux de ses groupes |
| `entity` | Ceux de l'entité active |
| `recursive` | Ceux de l'entité active et de sa descendance |
| `all` | Tous, dans le périmètre d'habilitation |

Exemple : un technicien de niveau 1 a `ticket:read = entity` et `ticket:update = group`. Il voit
tous les tickets de son entité mais ne modifie que ceux affectés à ses groupes.

La résolution effective des droits est mise en cache par `(utilisateur, profil, entité)` et
invalidée à toute modification de profil ou d'habilitation.

## 7. Row-Level Security — le filet de sécurité

Le filtrage applicatif reste la première ligne : il est explicite, testable et produit des
requêtes efficaces. Le RLS est la seconde ligne, celle qui garantit qu'un oubli dans le cœur ou
une requête brute écrite par un plugin **ne peut pas** faire fuiter des données entre entités.

Ouverture de transaction :

```sql
SET LOCAL tick.entity_path  = 'racine.filiale_nord.site_a';
SET LOCAL tick.scope_paths  = 'racine.filiale_nord.site_a';  -- ou le sous-arbre si récursif
SET LOCAL tick.user_id      = '42';
```

Les deux formes de politique correspondent aux deux natures d'objets de la section 3 :

```sql
-- Données : descendant du périmètre actif
CREATE POLICY tickets_scope ON tickets
  USING (entity_path <@ current_setting('tick.scope_paths')::ltree);

-- Configuration : entité courante, ou ancêtre marqué récursif
CREATE POLICY categories_scope ON itil_categories
  USING (
    entity_path = current_setting('tick.entity_path')::ltree
    OR (is_recursive AND entity_path @> current_setting('tick.entity_path')::ltree)
  );
```

Deux rôles PostgreSQL : un rôle applicatif soumis au RLS pour tout le trafic normal, et un rôle
de migration qui en est exempté. L'API n'utilise jamais le second en dehors des migrations.

## 8. Configuration héritée par entité

Matrice urgence × impact, délais de clôture automatique, paramètres d'enquête de satisfaction,
adresse d'expédition des courriels, calendrier ouvré, gabarit par défaut : chaque paramètre est
réglable par entité et accepte la valeur spéciale **« hériter du parent »** (stockée `NULL`).

La résolution remonte l'arbre jusqu'à trouver une valeur explicite, avec cache invalidé lors de
toute modification de configuration ou déplacement d'entité. L'interface affiche toujours d'où
vient la valeur effective — sans cela, le diagnostic devient impossible en production.

## 9. Ce que l'on teste obligatoirement

Ces cas sont des tests d'intégration exécutés contre une vraie base PostgreSQL, pas des intentions :

1. Un technicien de `Site A` ne voit aucun ticket de `Site B`, y compris par requête brute.
2. Un SLA racine récursif est sélectionnable depuis `Site A` ; le même sans le drapeau ne l'est pas.
3. Un utilisateur cumulant deux habilitations obtient exactement les droits du profil actif, jamais
   l'union des deux.
4. Déplacer `Site A` sous `Siège` met à jour tous les chemins descendants et change immédiatement
   les visibilités.
5. Un plugin qui exécute du SQL brut reste confiné au périmètre de la transaction courante.
6. Retirer un utilisateur d'un groupe annuaire révoque ses habilitations `is_dynamic`, et
   uniquement celles-là.
