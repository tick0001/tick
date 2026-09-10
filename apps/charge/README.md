# Banc d'essai

Mesurer comment Tick& se comporte à l'échelle, et **dire sur quoi** — un chiffre sans sa
machine ne veut rien dire.

## Le geste

```bash
make dev-services                 # PostgreSQL, Redis
make charge P=collectivite        # fabrique le volume
pnpm --filter @tick/api start     # l'API à mesurer
make mesurer                      # le banc d'essai
```

Trois paliers de volumétrie, choisis sur ce que le produit vise réellement :

| Palier         | Entités | Comptes | Tickets |
| -------------- | ------: | ------: | ------: |
| `pme`          |       5 |      50 |   5 000 |
| `collectivite` |      30 |     200 |  50 000 |
| `grand-compte` |     200 |   1 000 | 500 000 |

`make charge` **efface le jeu de charge précédent** avant d'écrire, et lui seul : le jeu de
démonstration porte d'autres textes et n'est pas touché. Sans cela la commande serait
additive, et le palier annoncé ne correspondrait plus à ce qui est mesuré.

## Ce que la mesure vaut, et ce qu'elle ne vaut pas

**Elle ne mesure pas Tick&.** Elle mesure Tick& sur un processeur donné, avec un volume donné,
sur des scénarios donnés. L'outil imprime les trois en tête de chaque exécution, et il faut les
reproduire chaque fois qu'un chiffre est cité.

**Elle sert à deux choses**, dans cet ordre :

1. **Trouver où ça plie.** Les seuils sont volontairement lâches ; ce qui se lit, c'est la forme
   de la courbe quand la simultanéité monte.
2. **Empêcher les régressions.** Une requête qui double de durée entre deux versions n'apparaît
   dans aucun des tests : ils vérifient ce que l'application répond, jamais en combien de temps.

**Elle ne tourne pas à chaque proposition de modification.** Les machines d'intégration continue
sont partagées et irrégulières ; des seuils absolus y clignoteraient sans rien dire.

## Ce qu'elle a déjà trouvé

À cinquante mille tickets, la liste — l'écran le plus ouvert du produit — balayait la table
entière puis triait par tas. Deux causes, et il fallait les deux :

**Aucun index ne servait le tri.** La liste ordonne par `(date_opened DESC, id DESC)` avec
`deleted_at IS NULL` ; le seul index candidat commençait par `status`. Corrigé par la migration
`0032_index_ouverture_tickets` — et il lui faut ses **deux** colonnes : un index sur la seule
date ne satisfait pas ce tri, et le premier jet, à une colonne, n'a rien changé.

**L'index ne suffisait pas.** Tant que la requête joignait `entities` et `itil_categories`, le
planificateur préférait joindre les cinquante mille lignes puis trier, plutôt que de parcourir
l'index. Les deux jointures sont devenues des sous-requêtes scalaires, évaluées cinquante et une
fois au lieu de cinquante mille. La jointure sur `entities` était interne, mais le Row-Level
Security garantit déjà qu'un ticket visible a son entité dans le périmètre : les lignes rendues
sont exactement les mêmes.

Mesuré sous Row-Level Security, avec le rôle applicatif, sur la requête réelle :

```
avec les jointures      Nested Loop sur 50 017 lignes, top-N heapsort   74,0 ms
avec les sous-requêtes  Index Scan, 51 lignes lues                       0,4 ms
```

Et de bout en bout, `GET /api/tickets?limit=50`, médiane sur douze appels, même machine :

```
avant   95 ms
après   31 ms          (témoin : /api/health, 5 ms)
```

Ce qui restait à expliquer l'est donc : le coût fixe de la route était sa requête SQL, et non le
côté Node. Les trente millisecondes qui subsistent sont le reste de la route — session,
sérialisation, boucle d'évènements — et se comparent aux cinq de la sonde de santé.

### Deuxième trouvaille : le planificateur croyait le disque lent

La liste **filtrée par statut** — le premier geste d'un agent qui arrive le matin — était deux
fois plus lente que la liste complète. Contre-intuitif : ajouter un filtre devrait réduire le
travail.

En cause, une estimation, pas un chemin d'accès. Le Row-Level Security compare des `ltree`, et
PostgreSQL ne sait pas estimer la sélectivité de `<@` : il applique une constante. Sur
`status = 'new'` il prévoyait **83** lignes là où il y en a **7 145**, en concluait qu'il
faudrait parcourir presque tout l'index pour en trouver cinquante et une, et préférait balayer.

Aucun index ne corrige cela — j'en ai créé un sur `(status, date_opened, id)` pour le vérifier :
il n'est jamais choisi, parce que c'est l'estimation qui décide, pas la forme de l'index. Il a
été supprimé.

Ce qui corrige, c'est **`random_page_cost`**. PostgreSQL le fixe à `4` par défaut, ce qui
suppose un disque à plateaux où une lecture au hasard coûte quatre fois une lecture séquentielle.
Sur un SSD le rapport est proche de `1`. À `1.1`, la même requête passe de **26,8 ms à 0,33 ms**.

Le réglage est désormais posé dans `docker/compose.yaml` et `docker/compose.production.yaml`,
avec la consigne de le remonter à `4` si les données vivent sur un disque à plateaux.

Il ne profite pas qu'à la liste. Banc complet, cinquante mille tickets, 50 connexions
simultanées, i7-1260P :

| scénario         | p95 avant | p95 après | débit avant → après |
| ---------------- | --------: | --------: | ------------------: |
| liste            |    369 ms |    246 ms |     165 → 247 req/s |
| liste filtrée    |    663 ms |    247 ms |      95 → 233 req/s |
| détail           |    288 ms |    204 ms |     206 → 291 req/s |
| recherche titre  |   1182 ms |    796 ms |       52 → 76 req/s |
| recherche statut |    777 ms |    585 ms |      83 → 109 req/s |
| indicateurs      |   1384 ms |   1000 ms |       42 → 60 req/s |

Six scénarios sur six progressent, aucun ne régresse. Une ligne de configuration.

### Troisième trouvaille : la recherche castait sa colonne

Le registre des champs interrogeables déclarait `tickets.status::text`. Un cast sur la colonne
interdit tout index : PostgreSQL balaie puis trie. Le cast ne protégeait de rien — le compilateur
refuse déjà toute valeur hors des choix déclarés, et une valeur invalide n'atteint jamais SQL.

```
avec ::text   Seq Scan sur 500 014 lignes, top-N heapsort   325 ms
sans          Index Scan, 51 lignes lues                      1,9 ms
```

De bout en bout, `POST /api/search/tickets` filtré par statut : **406 ms → 22 ms**. Le scénario
`recherche-statut` est passé d'un plafond de 8 requêtes par seconde, cassé dès cent connexions, à
la même courbe que la liste — 156 req/s, tenu jusqu'à cinq cents.

Un test le retient : `search-registry.service.test.ts` refuse tout cast sur une colonne du
registre. Remis en place, le cast le fait échouer.

## Ce que le banc a trouvé sur lui-même

Trois défauts de l'instrument, tous découverts en montant à cinq cent mille tickets, et tous
capables d'inventer des résultats. Ils sont notés parce qu'un banc d'essai qui ment est pire
qu'un banc absent.

**Il affichait des échecs comme des zéros.** Quand chaque requête est plus lente que la fenêtre
de mesure, `autocannon` rend zéro partout : zéro requête, zéro erreur, zéro milliseconde. La
première version imprimait `p50 0 ms · 0 req/s` — ce qui se lit comme « instantané » et signifie
l'inverse. Le compte des requêtes abouties est désormais lu, et un palier muet est un échec.

**Il mesurait le disque.** Sans échauffement, le premier appel à la liste sur une table de
584 Mio a pris **82 secondes**, le deuxième 117, le troisième 2 — puis 20 millisecondes une fois
la table en mémoire. La campagne entière ne mesurait que la lecture d'un fichier. Chaque scénario
est maintenant précédé d'un échauffement qui n'est pas compté.

**Il mesurait la traîne du palier précédent.** Après un palier à cinq cents connexions, la sonde
de santé a mis 120 secondes à répondre. Les scénarios suivants n'ont rien rendu — non qu'ils
soient lents, mais parce qu'ils attendaient derrière. Le banc attend désormais le retour au calme
entre chaque palier, **par une sonde qui passe par le pool de connexions** : la sonde de santé ne
convenait pas, elle répondait vite pendant que PostgreSQL avalait encore cinq cents balayages.
Le temps de retour au calme est imprimé — c'est la réponse à « combien de temps ce service
met-il à se remettre d'une rafale ».

Et il ne monte plus les paliers au-delà du point de rupture : une fois le p95 au-delà de cinq
secondes, les paliers suivants n'apprennent rien et ne font qu'empiler une file qui fausse le
scénario d'après.

## Ce qui plie, et où

Campagne complète à **cinq cent mille tickets**, i7-1260P, 16 Gio, PostgreSQL 18 en conteneur.

Les trois écrans de lecture — liste, liste filtrée, détail — **ne cassent pas**. Ils plafonnent
entre 166 et 209 requêtes par seconde dès vingt connexions, puis la latence croît linéairement
sans que le débit s'effondre, et sans une seule erreur jusqu'à cinq cents connexions saturées.
La file se vide en trois à quatre secondes. C'est la dégradation qu'on veut : on attend, on ne
tombe pas.

| scénario         | 1 conn. | plafond   | rupture        | retour au calme à 500 |
| ---------------- | ------: | --------- | -------------- | --------------------: |
| liste            |   17 ms | 166 req/s | aucune         |                 3,6 s |
| liste filtrée    |   18 ms | 172 req/s | aucune         |                 3,8 s |
| détail           |   12 ms | 209 req/s | aucune         |                 3,2 s |
| recherche statut |   18 ms | 156 req/s | aucune         |                 4,0 s |
| recherche titre  |  599 ms | 4 req/s   | 100 connexions |                     — |
| indicateurs      |  917 ms | 3 req/s   | 20 connexions  |                     — |

**Le mur n'est pas la simultanéité, ce sont deux routes.**

### La recherche textuelle, et pourquoi un index ne la sauve pas

`ILIKE '%mot%'` balaie les cinq cent mille lignes : 599 ms à une seule connexion, un plafond de
quatre requêtes par seconde. Un index trigramme GIN corrigerait cela — **et il ne peut pas
servir ici**.

Mesuré, pas supposé. Même requête, mêmes données, seul le rôle change :

```
rôle propriétaire, sans RLS   Bitmap Index Scan sur l'index trigramme   0,32 ms
rôle applicatif, sous RLS     Seq Scan sur 500 014 lignes             467 ms
```

La cause est structurelle. PostgreSQL refuse d'évaluer un prédicat **non _leakproof_** avant le
prédicat de sécurité d'une politique RLS — sinon un message d'erreur ou une différence de durée
pourrait révéler une ligne qu'on n'a pas le droit de voir. Or aucun opérateur de recherche
textuelle ne l'est :

| opérateur          | fonction        | _leakproof_ |
| ------------------ | --------------- | ----------- |
| `=` (texte)        | `texteq`        | oui         |
| `LIKE` / `ILIKE`   | `textlike`      | **non**     |
| `@@` (plein texte) | `ts_match_vq`   | **non**     |
| `%` (similarité)   | `similarity_op` | **non**     |

Le cloisonnement par RLS et l'indexation de la recherche textuelle sont donc **mutuellement
exclusifs** dans PostgreSQL. Sortir de là est un arbitrage, pas un correctif : il faudrait
appliquer la portée hors de RLS pour ce chemin, ou marquer un opérateur `LEAKPROOF` — ce que la
documentation de PostgreSQL présente comme un risque de fuite. Aucune des deux ne se décide dans
un commentaire de code.

En attendant, la recherche par titre est utilisable jusqu'au palier `collectivite` et cesse de
l'être bien avant `grand-compte`.

### Les indicateurs

`/api/stats` agrège tout le périmètre : 917 ms à une connexion, plafond à trois requêtes par
seconde, rupture dès vingt. C'est le coût d'un agrégat sur cinq cent mille lignes, et il n'a pas
encore été travaillé.

## Ce que la mesure a **infirmé**

Six soupçons formés en lisant le code, et démentis par la mesure. Ils sont notés ici pour que
personne ne les reprenne :

- **Les sous-requêtes corrélées** qui comptent suivis et tâches ne coûtent rien : 0,007 ms par
  ligne, parce qu'elles sont correctement indexées.
- **La recherche `contient` sur le titre** n'est pas le mur attendu. `pg_trgm` est activé sans
  index GIN sur les tickets, mais à cinquante mille lignes le balayage reste comparable au
  témoin indexé — 132 ms contre 107 ms de bout en bout.
- **La taille du pool de connexions** ne limitait pas : la doubler n'a rien changé au débit.
  Elle a tout de même été rendue réglable (`DATABASE_POOL_MAX`), parce qu'elle était le seul
  paramètre figé dans le code — mais ce n'est pas un correctif de performance.
- **Le réseau entre Node et PostgreSQL** : un aller-retour coûte 0,45 ms, et la route n'en fait
  que cinq.
- **Un plan de requête figé** : `ANALYZE` puis `DISCARD PLANS` ne changent rien. Le plan était
  le bon plan pour la requête telle qu'elle était écrite ; c'est la requête qu'il fallait
  changer.
- **Un index manquant sur `(status, date_opened, id)`** pour la liste filtrée : créé, mesuré,
  jamais choisi par le planificateur, supprimé. Le défaut était dans l'estimation.
