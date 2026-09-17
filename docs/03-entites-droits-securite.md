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
indexée. Sans cet opérateur, il faudrait tenir des caches d'ancêtres et de descendants, à
invalider à chaque déplacement ; ici un déplacement de sous-arbre est une seule mise à jour de
préfixe.

## 2. Rattachement des objets

Chaque objet porte `entity_id`. **Un ticket appartient à exactement une entité**, et ce
rattachement est décidé à la création (saisie, gabarit, ou règle d'affectation d'entité).

Chaque table concernée porte aussi une colonne dénormalisée `entity_path ltree`, maintenue par
déclencheur depuis `entities`. Elle sert uniquement à rendre les politiques RLS indexables sans
sous-requête. C'est une dénormalisation assumée et documentée.

## 3. Deux natures d'objets, deux règles de visibilité

C'est le point le plus souvent mal compris d'un modèle multi-entités, alors il est posé
explicitement ici.

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
c'est exactement ce qu'il serait tentant, et faux, de simplifier.

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

| Portée      | Signification                                         |
| ----------- | ----------------------------------------------------- |
| `own`       | Les objets dont l'utilisateur est demandeur ou auteur |
| `group`     | Ceux de ses groupes                                   |
| `entity`    | Ceux de l'entité active                               |
| `recursive` | Ceux de l'entité active et de sa descendance          |
| `all`       | Tous, dans le périmètre d'habilitation                |

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

Les deux formes de politique correspondent aux deux natures d'objets de la section 3. Elles sont
encapsulées dans deux fonctions, pour que chaque nouvelle table n'ait qu'à choisir sa nature :

```sql
-- Données : le périmètre habilité, et rien d'autre.
CREATE FUNCTION tick_in_scope(target ltree) RETURNS boolean AS $$
  SELECT target <@ tick_scope_paths() OR target = ANY (tick_exact_paths())
$$ LANGUAGE sql STABLE;

-- Configuration : le périmètre habilité, plus ce qu'un ancêtre partage
-- explicitement vers le bas par son drapeau récursif.
CREATE FUNCTION tick_config_visible(target ltree, recursive_flag boolean) RETURNS boolean AS $$
  SELECT tick_in_scope(target) OR (recursive_flag AND target @> tick_entity_path())
$$ LANGUAGE sql STABLE;

CREATE POLICY entities_scope ON entities FOR ALL TO tick_app
  USING (tick_in_scope(path));

CREATE POLICY groups_scope ON groups FOR ALL TO tick_app
  USING (tick_config_visible(entity_path, is_recursive))
  -- Un objet de configuration se crée dans l'entité active, jamais ailleurs.
  WITH CHECK (entity_path = tick_entity_path());
```

La politique de configuration couvre deux besoins qu'il serait tentant de confondre :
**l'administration** (quels groupes existent dans mon périmètre) et **l'usage** (quels groupes
puis-je choisir depuis l'entité active). Le premier terme répond au premier, le second au
deuxième — et c'est bien l'union des deux qu'un administrateur s'attend à voir.

Deux rôles PostgreSQL. Le **rôle applicatif**, soumis au RLS, porte tout le trafic des
utilisateurs. Le **rôle propriétaire** en est exempté : il joue les migrations, et sert à ce qui
précède une requête d'utilisateur ou la dépasse — authentification et sessions, travaux de fond
qui parcourent toutes les entités (escalades, récurrences, collecte de courriel, notifications,
enquêtes), gestion des plugins. Aucun code ne le reçoit avec un contexte d'utilisateur.

### Une exception, et une seule : la recherche textuelle

Sous RLS, aucune recherche textuelle ne peut utiliser d'index. PostgreSQL refuse d'évaluer un
prédicat non _leakproof_ avant le prédicat de sécurité d'une politique — une durée ou un message
d'erreur pourrait trahir une ligne interdite — et ni `ILIKE`, ni `@@`, ni `%` ne le sont. Pour la
même raison, il s'interdit les statistiques de la colonne et estime une ligne là où il y en a
des dizaines de milliers. Chercher un mot dans cinq cent mille tickets balayait la table entière.

`tick_tickets_semblables` lit donc l'index trigramme **en tant que propriétaire**, et c'est une
exception délibérée à la règle ci-dessus. Elle est tenue par quatre choses :

- elle applique elle-même `tick_in_scope(entity_path)`, le prédicat exact de la politique de la
  table : elle ne rend que ce que le RLS laisserait voir à l'appelant, et **rien** sans contexte ;
- elle ne rend **que des identifiants**, que la requête visible filtre ensuite par une égalité —
  _leakproof_ — et toujours sous RLS ;
- l'appelant ne fournit qu'un motif. Il ne choisit ni la colonne, prise dans une liste fermée, ni
  les conditions : une vue sans barrière de sécurité l'aurait laissé évaluer ses propres
  fonctions sur les lignes interdites ;
- son `search_path` est figé, et seul le rôle applicatif peut l'exécuter.

Ce qui fuit encore : la **durée**. L'index remonte les correspondances de toutes les entités
avant le filtre de périmètre, si bien que le temps d'exécution croît avec le nombre de tickets
semblables ailleurs. Le canal ne révèle ni un titre ni un identifiant, et la requête précédente,
qui balayait toute la table, en ouvrait un du même ordre.

### La compilation JIT, coupée

Même cause, autre effet. Les prédicats des politiques n'étant pas _leakproof_, le planificateur
surestime le coût des requêtes soumises au RLS. Au-delà de `jit_above_cost`, PostgreSQL les
compile alors avant de les jouer, à chaque exécution : 750 ms de compilation pour une recherche
de 50 ms dans la base de connaissances. `withRequestContext` coupe donc la JIT pour chaque
transaction applicative, par `set_config('jit', 'off', true)` : le réglage meurt avec la
transaction, et le serveur garde le sien pour tout autre usage.

La base de connaissances n'a pas eu besoin de l'exception accordée à la recherche des tickets :
sans JIT, sa recherche plein texte prend 95 à 145 ms sous RLS à cent mille articles, un volume
qu'aucune base de connaissances n'approche.

### Le périmètre habilité n'est pas le périmètre de travail

Deux notions que le mot « périmètre » recouvre indistinctement, et qu'il faut séparer :

- le **périmètre habilité** est l'union de toutes les habilitations de l'utilisateur, toutes
  branches et tous profils confondus. Il n'alimente qu'une chose : le sélecteur d'entité ;
- le **périmètre de travail** est l'entité active et, si l'utilisateur l'a demandé _et_ qu'une
  habilitation récursive le permet, sa descendance. C'est lui, et lui seul, qui est injecté dans
  le Row-Level Security.

Injecter le périmètre habilité dans le RLS reviendrait à faire fuiter une branche dans l'autre dès
qu'un utilisateur cumule deux habilitations. Demander la descendance ne suffit pas non plus à y
avoir droit : `includeSubEntities` n'est honoré que si une habilitation récursive couvre
réellement l'entité active.

## 8. Configuration héritée par entité

Matrice urgence × impact, délais de clôture automatique, paramètres d'enquête de satisfaction,
adresse d'expédition des courriels, calendrier ouvré, gabarit par défaut : chaque paramètre est
réglable par entité et accepte la valeur spéciale **« hériter du parent »** (stockée `NULL`).

La résolution remonte l'arbre jusqu'à trouver une valeur explicite, avec cache invalidé lors de
toute modification de configuration ou déplacement d'entité. L'interface affiche toujours d'où
vient la valeur effective — sans cela, le diagnostic devient impossible en production.

## 9. Ce que l'on teste obligatoirement

Ces cas sont des tests d'intégration exécutés contre une vraie base PostgreSQL **avec le rôle
applicatif**, pas des intentions. Les exécuter avec le rôle propriétaire les ferait tous passer
sans rien prouver, puisque celui-ci est exempté des politiques : c'est la raison pour laquelle le
rôle `tick_app` est créé par la première migration et non par un script d'initialisation de
conteneur, que l'intégration continue n'exécuterait pas.

1. Un technicien de `Site A` ne voit que `Site A`, quelle que soit la requête.
2. Un objet de configuration récursif défini à la racine est visible depuis `Site A` ; le même
   sans le drapeau ne l'est pas ; celui d'une entité sœur non plus.
3. Une requête SQL brute, telle qu'en écrirait un plugin, reste confinée au même périmètre.
4. Une habilitation récursive ouvre la descendance ; la même sans le drapeau ne l'ouvre pas.
5. Déplacer une entité met à jour tous les chemins descendants, fait suivre les objets rattachés,
   et bascule immédiatement les visibilités.
6. Une écriture visant une entité hors périmètre est refusée.
7. Une connexion sans contexte établi voit un périmètre **vide**, jamais un périmètre total.
8. La recherche textuelle, appelée en SQL brut avec le rôle applicatif, ne rend que les tickets du
   périmètre, et rien sans contexte. Ce test porte sur la fonction seule : la requête de la liste,
   restée sous RLS, réparerait une fonction qui oublierait le périmètre — et les tests du service
   resteraient verts. Vérifié en retirant le filtre : seuls les tests de la fonction échouent.

Deux cas supplémentaires relèvent des services et non des politiques :

8. Un utilisateur cumulant deux habilitations obtient exactement les droits du profil actif,
   jamais l'union des deux.
9. Retirer un utilisateur d'un groupe d'annuaire révoque ses habilitations `is_dynamic`, et
   uniquement celles-là.
