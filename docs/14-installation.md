# Installation et exploitation

Ce document décrit un déploiement de production **par conteneurs**. Pour
développer, voir le [README](../README.md) : ce n'est pas la même chose, et
confondre les deux mène à installer un jeu de démonstration sur une base de
production.

Beaucoup d'organisations n'autorisent pas de moteur de conteneurs sur un
serveur. Deux autres chemins existent, à partir des mêmes archives de version :

- [Installation sur Linux, sans conteneur](16-installation-linux.md) — paquets
  système, `systemd` et nginx. Procédure déroulée intégralement sur une machine
  vierge.
- [Installation sur Windows Server](17-installation-windows.md) — service
  Windows et IIS.

## Ce qu'il faut

Une machine avec Docker et le plugin Compose. Rien d'autre : PostgreSQL, Redis
et l'application arrivent en conteneurs. Compter 2 Go de mémoire pour un usage
de quelques dizaines de techniciens, et de la place disque pour les pièces
jointes — elles dominent la volumétrie bien avant les tickets.

**Podman** convient aussi, et c'est souvent le moteur autorisé là où Docker ne
l'est pas — il tourne sans démon privilégié. Remplacer `docker compose` par
`podman compose` dans toutes les commandes de ce document ; le reste est
identique.

Tick& n'expose **pas** de TLS. Il attend derrière un terminateur — Caddy, Traefik,
nginx, un répartiteur d'entreprise — qui présente le certificat et relaie en
clair sur le réseau local. Le déployer sans, c'est faire voyager les mots de
passe en clair.

## Images

Les images sont publiées sur GitHub Container Registry à chaque étiquette de version :

```
ghcr.io/tick0001/tick-api:0.1.0
ghcr.io/tick0001/tick-web:0.1.0
```

Publiques, donc tirables sans authentification. `TICK_VERSION` choisit la
version ; `latest` suit la dernière étiquette. Épingler une version précise est
préférable en production — `latest` change sous vos pieds à la publication
suivante.

Pour construire depuis les sources plutôt que tirer — audit du contenu, correctif
local, registre interne — `pnpm images` produit `tick-api:local` et
`tick-web:local` ; renseignez alors `TICK_IMAGE_API`, `TICK_IMAGE_WEB` et
`TICK_VERSION` en conséquence.

## Configuration

```bash
cp .env.production.example docker/.env
```

Le fichier va dans `docker/`, à côté du fichier compose — c'est là que Compose le cherche, pas à la
racine du dépôt. Un `.env` posé à la racine serait ignoré, et le démarrage échouerait sur une
variable manquante.

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

## Derrière Traefik

Si un Traefik tourne déjà sur la machine, il n'y a **rien à fusionner** avec le
nginx du conteneur `web` : les deux ne font pas le même métier.

Le nginx interne est une pièce de l'application. Il sert les fichiers de
l'interface, replie les routes du navigateur sur `index.html` — sans quoi
recharger `/tickets/42` renverrait une 404 — et relaie `/api/` vers l'API, ce
qui garde l'interface et l'API sur la **même origine**. C'est cette même origine
qui permet au cookie de session, `httpOnly` et `SameSite`, de voyager.

Traefik termine le TLS et route un nom de domaine vers le conteneur. Traefik
devant, nginx dedans, et le fichier [`compose.traefik.yaml`](../docker/compose.traefik.yaml)
se superpose au fichier de production.

**Cette surcouche ne lance pas Traefik** : elle ne déclare aucun service. Le
Traefik reste le vôtre, dans son propre compose, avec sa propre configuration —
la surcouche ne fait que lui donner un conteneur de plus à router, en posant les
étiquettes sur `web` et en le rattachant au réseau existant.

```bash
docker compose -f docker/compose.production.yaml \
               -f docker/compose.traefik.yaml up -d
```

Il retire le port publié, attache `web` au réseau de Traefik en plus de celui du
projet, et pose les étiquettes du routeur. Quatre variables à renseigner dans
`docker/.env`, en accord avec la stack Traefik existante :

```ini
TICK_HOST=assistance.exemple.fr
TRAEFIK_NETWORK=traefik
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=letsencrypt
```

Les valeurs par défaut sont les conventions les plus répandues, pas
nécessairement les vôtres : les trois dernières se lisent dans la configuration
du Traefik déjà en place. Et `API_URL` comme `WEB_URL` passent en `https://`,
sinon les liens des notifications pointeront ailleurs que le site.

Le port publié disparaît à dessein. Le garder ouvrirait l'application en clair
sur un port de l'hôte, à côté du TLS de Traefik — et comme le cookie de session
porte l'attribut `Secure` en production, une connexion par ce chemin-là
échouerait **sans message** : le navigateur refuserait simplement d'enregistrer
le cookie.

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

## Instance de démonstration publique

Une troisième surcouche, [`compose.demo.yaml`](../docker/compose.demo.yaml),
transforme le déploiement en vitrine publique. Elle **n'a rien à faire sur une
installation réelle** : elle vide la base toutes les heures.

```bash
docker compose -f docker/compose.production.yaml \
               -f docker/compose.traefik.yaml \
               -f docker/compose.demo.yaml up -d
```

Elle fait trois choses, et chacune répond à un problème que pose une
démonstration ouverte à tous.

**Le courrier ne sort plus.** Sur une démonstration, n'importe quel visiteur est
administrateur : il peut composer une notification et déclencher son envoi. Avec
un vrai relais SMTP configuré, la démonstration devient un relais de courrier
ouvert, et c'est le nom de domaine qui finit sur les listes noires. La surcouche
écrase `SMTP_HOST` vers un conteneur Mailpit qui accepte tout et n'expédie rien.

**Le jeu de démonstration se recharge à chaque heure ronde**, par le service
`demo-reset` et le script [`demo-reset.sh`](../docker/demo-reset.sh). L'heure
ronde plutôt qu'un intervalle depuis le démarrage, pour pouvoir annoncer aux
visiteurs « remise à zéro à chaque heure » sans mentir.

**Les pièces jointes sont effacées** au même moment. `seed.js` ne tronque que
les tables ; sans ce nettoyage, le volume grossit sans fin et la démonstration
finit par héberger durablement des fichiers que personne n'a relus.

Le nettoyage n'a pas lieu si l'amorçage échoue : mieux vaut une démonstration
figée sur des données cohérentes qu'une démonstration dont les tickets
référencent des pièces jointes disparues.

**Deux familles d'écriture sont refusées** par une configuration nginx dédiée,
[`nginx-demo.conf`](../docker/nginx-demo.conf), montée sur le conteneur `web`.
Sur une démonstration les identifiants sont publiés : tout visiteur est
administrateur, et deux capacités d'administration deviennent dangereuses quand
celui qui les détient n'est pas de confiance.

- **Le téléversement de pièces jointes.** Le contrôle de type accepte les
  images — ce qu'il faut pour un ticket, et exactement le vecteur d'un contenu
  proscrit déposé sur un service ouvert à tous. La remise à zéro efface le
  fichier, mais une adresse partagée pendant l'heure fonctionne, et l'exposition
  juridique porte sur le nom de domaine.
- **Les annuaires LDAP et les collecteurs de courriel.** Les deux se configurent
  avec un hôte et un port libres, puis se déclenchent à la demande. C'est une
  requête sortante arbitraire émise par le serveur : de quoi sonder son réseau
  interne — les autres conteneurs, les services d'administration, les adresses
  de métadonnées.

La lecture reste ouverte dans les deux cas : les écrans se visitent, seule
l'écriture est refusée. Créer un ticket, le commenter, le résoudre, poser une
règle ou un engagement — tout le reste fonctionne.

Les comptes sont ceux du [README](../README.md), mot de passe commun `tick`.
L'application ne les affiche nulle part : c'est au lien que vous publiez de les
porter.

`initialiser` est inutile ici — l'amorçage crée les comptes lui-même.
