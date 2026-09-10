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
entière puis triait par tas. Aucun index ne servait `ORDER BY date_opened DESC` avec
`deleted_at IS NULL` : le seul candidat commençait par `status`.

```
sans l'index   Seq Scan sur 50 007 lignes, puis top-N heapsort   18,4 ms
avec l'index   Index Scan, cinquante lignes lues                  0,35 ms
```

Corrigé par la migration `0032_index_ouverture_tickets`.

## Ce que la mesure a **infirmé**

Trois soupçons formés en lisant le code, et démentis par la mesure. Ils sont notés ici pour que
personne ne les reprenne :

- **Les sous-requêtes corrélées** qui comptent suivis et tâches ne coûtent rien : 0,007 ms par
  ligne, parce qu'elles sont correctement indexées.
- **La recherche `contient` sur le titre** n'est pas le mur attendu. `pg_trgm` est activé sans
  index GIN sur les tickets, mais à cinquante mille lignes le balayage reste comparable au
  témoin indexé — 132 ms contre 107 ms de bout en bout.
- **La taille du pool de connexions** ne limitait pas : la doubler n'a rien changé au débit.
  Elle a tout de même été rendue réglable (`DATABASE_POOL_MAX`), parce qu'elle était le seul
  paramètre figé dans le code — mais ce n'est pas un correctif de performance.

## Ce qui reste inexpliqué

Sur un poste de développement, `/api/tickets` répond en **≈ 180 ms** alors que sa requête SQL
coûte **0,5 ms** sous Row-Level Security, et que la route ne déclenche que cinq transactions.
Le coût est **fixe** — identique pour une ligne et pour cinquante — et propre à cette route :
`/api/entities` répond en 25 ms, la sonde de santé en 2 ms.

Ont été éliminés par la mesure : le coût SQL, le Row-Level Security, la taille du pool, la
sérialisation par ligne, le middleware d'authentification, et un plan de requête figé. Il reste
à profiler le côté Node.
