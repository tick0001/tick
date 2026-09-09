# Contribuer à Tick&

> **A note in English.** The codebase, its comments, its documentation and its commit
> messages are all in **French**, and there is no plan to change that. You will be reading
> French all day. The interface and the emails are bilingual — the project around them is
> not. Better to know before cloning than after.
>
> Bug reports in English are welcome all the same: open an issue, someone will read it.

Merci d'être passé. Le projet est jeune — première version étiquetée, jamais utilisé par un
vrai centre de services — et ce sont donc les retours d'usage qui valent le plus.

## Ce qui aide le plus, dans l'ordre

**Installer Tick& et dire ce qui a cassé.** C'est ce qui manque le plus. La documentation
décrit quatre chemins d'installation, dont deux ont été déroulés sur une machine vierge et
deux non — le guide Windows le dit lui-même. Un rapport qui commence par « j'ai suivi le
guide et je suis bloqué à l'étape 6 » vaut plus qu'un correctif.

**Écrire un plugin d'essai.** Le SDK reste en `0.x` et ne se figera qu'une fois chaque point
d'extension exercé par un usage réel ; le plugin de référence ne suffit pas à prouver qu'une
interface est bonne. Voir le [SDK](docs/15-sdk-plugins.md).

**Signaler une anomalie.** Y compris « ce n'est pas clair », qui est un défaut de
documentation et non un caprice.

## Avant de coder

Ouvrez une issue d'abord, sauf pour une correction évidente. Le projet a des partis pris
argumentés — le cloisonnement appliqué par la base, l'absence d'ombres portées, un périmètre
qui exclut la gestion de parc — et une proposition qui les ignore se heurtera à un refus qui
n'a rien de personnel. Les raisons sont dans [`docs/`](docs/), et
[l'architecture](docs/02-architecture.md) les récapitule.

## Démarrer

Prérequis : Node 22 ou plus, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
make dev              # services, API et interface
```

Sans `make`, les commandes équivalentes sont dans le [Makefile](Makefile) — il est lisible,
c'est son but.

## Les branches

`main` ne reçoit que des versions publiées. On n'y pousse pas — la branche est protégée, et
c'est délibéré : tout ce qui s'y trouve porte une étiquette, si bien qu'un clone de `main` est
toujours quelque chose qu'on peut installer.

```
feature/…  ──(rebase)──>  develop  ──(coupe)──>  release/0.1.7  ──(fusion)──>  main
                             ↑                                                   │
                        dependabot                          étiquette, images et archives
```

**Une branche par sujet**, partant de `develop` et fusionnée par _rebase_ : l'historique de
`develop` reste une suite de commits lisibles, sans les allers-retours d'une revue.

**Une version se publie en fusionnant `release/<version>` dans `main`.** Le numéro vit dans le
nom de la branche, et nulle part ailleurs : c'est ce qui permet à une pull request d'annoncer
ce qu'elle publie avant d'être fusionnée, et à toute autre — un correctif de sécurité, une
retouche de documentation — d'atteindre `main` sans rien publier. La fusion déclenche la
vérification du manifeste, l'étiquette, puis les images et les archives. Rien à faire à la
main, et rien à étiqueter soi-même.

```bash
make version V=0.1.7      # coupe release/0.1.7, monte le manifeste, date le journal
```

Le nom de la branche doit concorder avec `apps/api/package.json` : c'est ce manifeste que lit
`/api/health`, et une divergence ferait annoncer à l'installation une version qui n'est pas la
sienne. La publication refuse de partir dans ce cas — comme elle refuse de réétiqueter une
version déjà publiée.

**`release/<version>` vers `main` se fusionne avec un commit de fusion**, et c'est la seule
exception au _rebase_. Un _rebase_ réécrirait les commits, et `develop` se retrouverait à
porter des doublons orphelins de ce qui est déjà sur `main`.

Dependabot vise `develop` pour ses montées de version. Ses correctifs de sécurité, eux, visent
`main` : GitHub ne permet pas de les rediriger, et il n'y a pas lieu de le vouloir.

## Avant d'ouvrir une pull request

```bash
make verifier         # lint, typecheck, format et tests
```

L'intégration continue lance exactement cela, plus les tests d'intégration sur une vraie base
PostgreSQL. Un échec local est un échec distant.

**Écrivez un test qui échoue sans votre correctif.** C'est la seule preuve qu'il corrige
quelque chose. Un test qui passe avant comme après ne démontre rien, et il est plus difficile
à repérer qu'à écrire.

## Conventions

**Les commits sont en français, courts, préfixés d'un gitmoji.**

```
:sparkles: ajoute l'arbre des entités
:bug: la sonde n'attestait pas que la base répond
```

Le message dit **ce que le commit change**, pas ce que vous avez fait. Le corps sert au
_pourquoi_, quand il n'est pas évident.

**Les commentaires expliquent pourquoi, pas quoi.** Le code dit déjà ce qu'il fait. Un
commentaire qui paraphrase la ligne suivante est du bruit qui vieillit mal ; un commentaire
qui explique le piège évité vaut dix minutes au prochain lecteur. Le dépôt en est plein, et
c'est délibéré.

**Le français du code est sans accents** — noms de variables, de fonctions, commentaires
techniques. La documentation et les textes d'interface, eux, sont accentués normalement.

## Ce que le projet n'acceptera pas

- **La gestion de parc et l'inventaire.** C'est un choix de périmètre, pas un manque.
- **Une dépendance à un service tiers** pour une fonction du cœur. Tick& s'auto-héberge, et
  ce que vous installez ne doit appeler personne.
- **Un contournement du Row-Level Security.** Le cloisonnement est appliqué par la base, et
  une requête qui passe par le rôle propriétaire pour aller plus vite retire le filet.

## Code de conduite

Le projet suit le [Contributor Covenant](CODE_OF_CONDUCT.md). En clair : les désaccords
techniques sont bienvenus, les attaques personnelles non.

## Licence

En contribuant, vous acceptez que votre travail soit distribué sous
[AGPL-3.0-or-later](LICENSE), comme le reste. Un plugin chargé dans le processus de l'API en
est très probablement une œuvre dérivée : à lire avant d'en écrire un propriétaire.
