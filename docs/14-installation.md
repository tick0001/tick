# Installation et exploitation

Ce document décrit un déploiement de production. Pour développer, voir le
[README](../README.md) : ce n'est pas la même chose, et confondre les deux mène
à installer un jeu de démonstration sur une base de production.

## Ce qu'il faut

Une machine avec Docker et le plugin Compose. Rien d'autre : PostgreSQL, Redis
et l'application arrivent en conteneurs. Compter 2 Go de mémoire pour un usage
de quelques dizaines de techniciens, et de la place disque pour les pièces
jointes — elles dominent la volumétrie bien avant les tickets.

Tick& n'expose **pas** de TLS. Il attend derrière un terminateur — Caddy, Traefik,
nginx, un répartiteur d'entreprise — qui présente le certificat et relaie en
clair sur le réseau local. Le déployer sans, c'est faire voyager les mots de
passe en clair.

## Images

Elles sont publiées sur GitHub Container Registry à chaque étiquette de version :

```
ghcr.io/tick0001/tick-api:1.0.0
ghcr.io/tick0001/tick-web:1.0.0
```

Publiques, donc tirables sans authentification. `TICK_VERSION` choisit la
version ; `latest` suit la dernière étiquette. Épingler une version précise est
préférable en production — `latest` change sous vos pieds à la publication
suivante.

Pour construire depuis les sources — pour développer une modification, ou avant
la première publication :

```bash
pnpm images
```

Cela produit `tick-api:local` et `tick-web:local`. Renseigner alors
`TICK_IMAGE_API`, `TICK_IMAGE_WEB` et `TICK_VERSION` en conséquence.

## Configuration

```bash
cp .env.production.example .env
```

Puis remplir. Le fichier compose refuse de démarrer si une variable obligatoire
manque, plutôt que de lancer un service qui échouerait plus tard sur une erreur
sans rapport apparent.

Trois valeurs demandent de l'attention.

**`SESSION_SECRET`** signe les cookies. En changer déconnecte tout le monde,
sans autre conséquence.

**`ENCRYPTION_KEY`** chiffre les secrets stockés en base : mots de passe des
comptes de service d'annuaire et des boîtes relevées. **La perdre les rend
définitivement illisibles** — il faudra tous les ressaisir. Elle se sauvegarde à
part de la base : une sauvegarde qui contient les deux livre les deux d'un coup.

```bash
openssl rand -hex 32   # une fois pour chaque
```

**`API_URL` et `WEB_URL`** sont les adresses telles que les navigateurs les
voient, pas celles du réseau interne. Elles composent les liens des
notifications : une valeur fausse produit des courriels dont les liens ne mènent
nulle part, et cela ne se découvre qu'à la première notification envoyée.

## Mot de passe du rôle applicatif

La migration initiale crée le rôle `tick_app` avec un mot de passe par défaut.
C'est commode en développement et **inacceptable en production** : il est écrit
dans le dépôt public.

Après le premier démarrage :

```bash
docker compose -f docker/compose.production.yaml exec postgres \
  psql -U tick -d tick -c "ALTER ROLE tick_app PASSWORD 'le-nouveau';"
```

Puis reporter le même mot de passe dans `DATABASE_APP_URL` et redémarrer l'API.
Tant que ce n'est pas fait, quiconque atteint le port PostgreSQL entre avec un
mot de passe connu de tous.

Les deux rôles ne sont pas une précaution de style. `DATABASE_URL` est le
propriétaire : il possède les tables et **échappe** au Row-Level Security ; il ne
sert qu'aux migrations. `DATABASE_APP_URL` porte tout le trafic normal et y est
soumis. Les intervertir désactiverait le cloisonnement entre entités sans qu'un
seul message ne le signale.

## Démarrage

```bash
docker compose -f docker/compose.production.yaml up -d
```

L'ordre est tenu par le fichier : PostgreSQL et Redis d'abord, puis `migrate`
qui applique les migrations **une fois** et rend la main, puis l'API qui attend
qu'il ait fini, puis l'interface.

C'est ce qui évite le défaut classique des images qui migrent au démarrage : deux
conteneurs lancés ensemble jouent la même migration en parallèle, et la seconde
échoue — ou pire, s'applique à moitié.

## Premier administrateur

Une base migrée est une base dans laquelle personne ne peut entrer : il n'y a ni
entité, ni profil, ni compte, et l'écran de connexion refuse tout le monde sans
dire pourquoi.

```bash
docker compose -f docker/compose.production.yaml run --rm \
  -e TICK_ADMIN_PASSWORD='…' \
  -e TICK_ADMIN_EMAIL='vous@exemple.fr' \
  api node dist/cli/initialiser.js
```

La commande crée une entité racine, un profil `Administrateur` doté de tous les
droits du catalogue, et un compte habilité dessus de façon récursive. Elle
**refuse de s'exécuter** si un compte existe déjà : une commande d'initialisation
qui accepte de tourner deux fois finit par être lancée sur une base vivante.

Le mot de passe passe par l'environnement plutôt que par un argument : sur un
serveur, un argument de ligne de commande se lit dans `ps`, ce qui livrerait le
compte d'administration à quiconque a un terminal sur la machine.

Options : `--identifiant=`, `--entite=`, `--courriel=`, ou les variables
`TICK_ADMIN_USERNAME`, `TICK_ROOT_ENTITY`, `TICK_ADMIN_EMAIL`.

N'utilisez **jamais** `db:seed` ici : il vide toutes les tables avant d'écrire un
jeu de démonstration.

## Vérification

```bash
curl http://localhost:8080/api/health
```

Doit répondre `{"status":"ok",…}`. La route interroge la base et Redis : un
processus vivant mais sans base n'est pas un service en état de servir, et la
sonde de santé du conteneur s'appuie dessus.

Puis ouvrir l'interface et se connecter avec le compte créé.

## Sauvegarde

Trois choses, et les trois sont nécessaires — restaurer deux sur trois donne une
instance qui démarre et ne fonctionne pas.

| Quoi                  | Comment                                                |
| --------------------- | ------------------------------------------------------ |
| La base               | `pg_dump` depuis le conteneur PostgreSQL               |
| Les pièces jointes    | Le volume `storage`                                    |
| La clé de chiffrement | `ENCRYPTION_KEY`, **hors** de la sauvegarde de la base |

```bash
docker compose -f docker/compose.production.yaml exec -T postgres \
  pg_dump -U tick -Fc tick > tick-$(date +%F).dump
```

Redis n'a pas besoin d'être sauvegardé : il ne porte que des files d'attente.
Le perdre fait au pire repartir des notifications non encore envoyées.

## Mise à jour

```bash
docker compose -f docker/compose.production.yaml pull
docker compose -f docker/compose.production.yaml up -d
```

Le service `migrate` rejoue au passage les migrations en attente, et l'API
n'est recréée qu'après. **Sauvegarder la base avant** : les migrations ne se
défont pas.

## Plugins

Un plugin est du code chargé dans le processus de l'API. Déposer son dossier
construit dans `./plugins`, à côté du fichier compose, puis redémarrer l'API. Il
apparaît alors dans l'écran d'administration, où il s'installe et s'active.

Le dossier est monté en lecture seule : un plugin compromis pourrait sinon se
réécrire, et survivre à sa propre désinstallation.

Conséquence de la licence : Tick& est sous AGPL-3.0, sans exception de liaison.
Un plugin chargé dans le même processus est très probablement une œuvre dérivée,
donc soumis à la même licence. Voir [Système de plugins](04-plugins.md).

## Journaux et diagnostic

```bash
docker compose -f docker/compose.production.yaml logs -f api
```

`LOG_LEVEL` accepte `error`, `warn`, `log`, `debug`, `verbose`, cumulatifs du
plus grave au plus bavard.

| Symptôme                                         | Cause la plus fréquente                                              |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `migrate` sort en erreur                         | `DATABASE_URL` pointe sur le rôle applicatif, qui ne peut pas migrer |
| L'API démarre puis n'est jamais saine            | `DATABASE_APP_URL` faux, ou mot de passe de `tick_app` déjà tourné   |
| Connexion refusée avec le bon mot de passe       | Le compte n'a aucune habilitation : il existe mais ne voit rien      |
| Les liens des notifications ne mènent nulle part | `WEB_URL` porte l'adresse interne et non l'adresse publique          |
| Une pièce jointe volumineuse est refusée         | Limite du terminateur TLS en amont, avant celle de nginx (32 Mo)     |

## Description de l'API

Le document OpenAPI est servi par l'application elle-même, sans authentification :

```
GET /api/openapi.json
```

Il est déduit des contrôleurs et des schémas qu'ils valident réellement — il ne
peut donc pas décrire une route qui n'existe pas, ni omettre celle qu'on vient
d'ajouter. Chaque opération porte le droit qu'elle exige, sous
`x-tick-droit`.

Pour l'obtenir hors ligne : `pnpm openapi > openapi.json`.
