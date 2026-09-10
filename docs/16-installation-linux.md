# Installation sur Linux, sans conteneur

Ce document décrit une installation de production sur une machine Linux, sans
Docker ni aucun moteur de conteneurs. C'est le chemin à suivre quand la
politique de l'organisation interdit un moteur de conteneurs sur un serveur, ce
qui reste courant en environnement régulé.

Si Docker ou Podman sont disponibles, le [déploiement par
conteneurs](14-installation.md) demande moins de travail et moins d'entretien.

Cette procédure a été déroulée intégralement sur une Debian 12 vierge — paquets,
migrations, création du premier compte, démarrage et connexion. Les commandes
ci-dessous sont celles qui ont été exécutées, pas une reconstitution.

## Ce qu'il faut

| Composant  | Version   | Rôle                                          |
| ---------- | --------- | --------------------------------------------- |
| Node.js    | 22 ou 24  | Exécution de l'API                            |
| PostgreSQL | 18        | Données, et le cloisonnement par RLS          |
| Redis      | 7 ou plus | Files de travaux : courriels, escalades, etc. |
| nginx      | récent    | Sert l'interface et relaie l'API              |

Redis n'est **pas** optionnel : six files en dépendent, dont l'escalade des
engagements de service. Sans Redis, pas de SLA.

Compter 2 Go de mémoire pour quelques dizaines de techniciens, et de la place
disque pour les pièces jointes — elles dominent la volumétrie bien avant les
tickets.

Tick& n'expose **pas** de TLS. Il attend derrière un terminateur — nginx avec un
certificat, ou un répartiteur d'entreprise en amont. Le déployer sans, c'est
faire voyager les mots de passe en clair.

## 1. Paquets système

### Debian et Ubuntu

Les versions de Node et de PostgreSQL des dépôts Debian sont trop anciennes pour
Tick& : il faut les dépôts amont.

```bash
apt-get update
apt-get install -y curl ca-certificates gnupg lsb-release

# Node.js 22 — dépôt NodeSource
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

# PostgreSQL 18 — dépôt PGDG
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

apt-get update
apt-get install -y nodejs postgresql-18 redis-server nginx
```

### RHEL, Rocky et AlmaLinux

```bash
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
dnf -qy module disable postgresql
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs postgresql18-server redis nginx

/usr/pgsql-18/bin/postgresql-18-setup initdb
systemctl enable --now postgresql-18 redis nginx
```

**SELinux.** En mode _enforcing_, nginx n'a pas le droit d'ouvrir une connexion
réseau, ce qui fait échouer le relais vers l'API avec une 502 sans explication
lisible dans le journal de nginx :

```bash
setsebool -P httpd_can_network_connect 1
```

## 2. Utilisateur et arborescence

L'API tourne sous un compte dédié, sans shell : un service qui n'a pas besoin de
se connecter ne doit pas pouvoir le faire.

```bash
useradd --system --home /opt/tick --shell /usr/sbin/nologin tick

mkdir -p /opt/tick/api          # code de l'API
mkdir -p /var/www/tick          # interface, servie par nginx
mkdir -p /var/lib/tick/storage  # pièces jointes
mkdir -p /etc/tick              # configuration et secrets

chown -R tick:tick /var/lib/tick
```

## 3. Base de données

```bash
su - postgres -c "psql -c \"CREATE ROLE tick LOGIN CREATEROLE PASSWORD 'un-mot-de-passe-solide'\""
su - postgres -c "createdb -O tick tick"
```

**`CREATEROLE` n'est pas décoratif.** La migration initiale crée le rôle
applicatif `tick_app`, et sans cet attribut elle échoue sur
`permission denied to create role`, après avoir déjà appliqué une partie du
schéma. C'est la différence la plus fréquente avec un déploiement par
conteneurs, où l'image PostgreSQL fait du propriétaire un superutilisateur sans
qu'on ait rien demandé.

Sur une base gérée où `CREATEROLE` n'est pas accordable, créez `tick_app`
vous-même avant de migrer — la migration le laisse en place s'il existe déjà :

```sql
CREATE ROLE tick_app LOGIN PASSWORD 'un-autre-mot-de-passe-solide';
```

### Un réglage, et un seul

```bash
su - postgres -c "psql -c \"ALTER DATABASE tick SET random_page_cost = 1.1\""
```

PostgreSQL fixe `random_page_cost` à `4` par défaut, ce qui suppose un disque à
plateaux où une lecture au hasard coûte quatre fois une lecture séquentielle. Sur
un SSD le rapport est proche de `1`, et la valeur par défaut pousse le
planificateur à balayer des tables entières plutôt qu'à suivre un index. Mesuré à
cinquante mille tickets et cinquante connexions simultanées, les six scénarios du
banc d'essai gagnent entre 25 % et 145 % de débit, aucun ne régresse.

**Sur un disque à plateaux, ne le posez pas** : la valeur par défaut est la bonne.

C'est le seul paramètre que Tick& vous demande de régler. `shared_buffers`,
`work_mem` et les autres dépendent de votre machine et de votre charge : les
recopier d'un guide générique fait plus de mal que de bien.

Les quatre extensions requises — `citext`, `ltree`, `pg_trgm`, `unaccent` — sont
des extensions dites _de confiance_ : le propriétaire de la base les installe
sans être superutilisateur. Rien à faire de plus.

## 4. Archives de version

Les archives sont attachées à chaque [version publiée](https://github.com/tick0001/tick/releases).
Elles sont autonomes : code compilé et dépendances incluses. Le serveur n'a
donc besoin ni de pnpm, ni d'un compilateur, ni du dépôt.

```bash
VERSION=0.1.0
cd /tmp
curl -fLO https://github.com/tick0001/tick/releases/download/v$VERSION/tick-api-$VERSION-linux-x64.tar.gz
curl -fLO https://github.com/tick0001/tick/releases/download/v$VERSION/tick-web-$VERSION.tar.gz

tar xzf tick-api-$VERSION-linux-x64.tar.gz -C /opt/tick/api
tar xzf tick-web-$VERSION.tar.gz -C /var/www/tick
```

**L'archive `linux-x64` est bâtie sur glibc** — Debian, Ubuntu, RHEL, Rocky,
SUSE. Elle ne fonctionne pas sur une distribution en musl comme Alpine :
`@node-rs/argon2` est un module natif, et le binaire n'est pas le même. Sur
Alpine, utilisez les images de conteneurs, qui sont bâties dessus.

## 5. Configuration

Les secrets vivent dans un fichier que seul le service peut lire.

```bash
touch /etc/tick/tick.env
chown root:tick /etc/tick/tick.env
chmod 0640 /etc/tick/tick.env
```

Générer les deux secrets avec `openssl rand -hex 32`, puis remplir :

```ini
NODE_ENV=production
API_PORT=3000

# Telles que les navigateurs les voient : elles composent les liens des
# notifications. Une adresse fausse produit des courriels dont les liens ne
# mènent nulle part, ce qui ne se découvre qu'à la première notification.
API_URL=https://assistance.exemple.fr
WEB_URL=https://assistance.exemple.fr

# Deux rôles, et ce n'est pas une précaution de style. Le propriétaire possède
# les tables et échappe au Row-Level Security ; il ne sert qu'aux migrations.
# Le rôle applicatif porte tout le trafic normal et y est soumis. Les
# intervertir désactiverait le cloisonnement entre entités en silence.
DATABASE_URL=postgres://tick:MOT_DE_PASSE@127.0.0.1:5432/tick
DATABASE_APP_URL=postgres://tick_app:MOT_DE_PASSE_APP@127.0.0.1:5432/tick

REDIS_URL=redis://127.0.0.1:6379

SESSION_SECRET=
ENCRYPTION_KEY=

# Chemin absolu : le service démarre depuis /opt/tick/api, et un chemin relatif
# écrirait les pièces jointes dans l'arborescence du code, que la mise à jour
# remplace.
STORAGE_PATH=/var/lib/tick/storage

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=assistance@exemple.fr

# Message affiche sur l'ecran de connexion, avant toute authentification.
# Vide par defaut, 500 caracteres au plus, rendu comme du texte.
LOGIN_BANNER=

DEFAULT_LOCALE=fr
LOG_LEVEL=log
```

`ENCRYPTION_KEY` doit faire exactement 32 octets en hexadécimal, soit 64
caractères. La perdre rend définitivement illisibles les mots de passe
d'annuaire et de collecteur stockés en base : à sauvegarder **à part** de la
base, sans quoi une sauvegarde compromise livre les deux d'un coup.

## 6. Migrations

Les migrations se jouent avec le rôle propriétaire, jamais avec le rôle
applicatif : une migration appliquée sous RLS ne toucherait que les lignes que
les politiques laissent voir.

```bash
cd /opt/tick/api
DATABASE_URL='postgres://tick:MOT_DE_PASSE@127.0.0.1:5432/tick' \
  node node_modules/@tick/db/dist/migrate.js
```

## 7. Mot de passe du rôle applicatif

La migration crée `tick_app` avec un mot de passe par défaut, écrit dans le
dépôt public. Commode en développement, **inacceptable en production**.

```bash
su - postgres -c "psql -d tick -c \"ALTER ROLE tick_app PASSWORD 'le-nouveau'\""
```

Reporter le même mot de passe dans `DATABASE_APP_URL`. Tant que ce n'est pas
fait, quiconque atteint le port PostgreSQL entre avec un mot de passe connu de
tous.

## 8. Premier administrateur

Sans lui, l'installation est migrée mais personne ne peut y entrer.

```bash
cd /opt/tick/api
set -a; . /etc/tick/tick.env; set +a
TICK_ADMIN_PASSWORD='…' node dist/cli/initialiser.js
```

Le mot de passe passe par l'environnement et non par un argument : un argument
de ligne de commande se lit dans `ps`, par n'importe quel utilisateur de la
machine.

La commande refuse de s'exécuter si un compte existe déjà — elle ne peut donc
pas écraser une installation en service.

## 9. Service systemd

L'unité est fournie dans le dépôt : [`deploy/linux/tick-api.service`](../deploy/linux/tick-api.service).

```bash
install -m 0644 deploy/linux/tick-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tick-api
systemctl status tick-api
```

Elle tourne sous le compte `tick`, lit ses secrets dans `/etc/tick/tick.env`, et
n'a le droit d'écrire que dans `/var/lib/tick/storage`. Si vous déplacez le
dossier des pièces jointes, il faut ajuster `ReadWritePaths` dans l'unité :
`ProtectSystem=strict` rend le reste du système en lecture seule pour ce
service, et l'oubli se manifeste au premier téléversement.

## 10. nginx

Le site est fourni dans le dépôt : [`deploy/linux/nginx-tick.conf`](../deploy/linux/nginx-tick.conf).

```bash
# Debian et Ubuntu
install -m 0644 deploy/linux/nginx-tick.conf /etc/nginx/sites-available/tick
ln -sf /etc/nginx/sites-available/tick /etc/nginx/sites-enabled/tick
rm -f /etc/nginx/sites-enabled/default

# RHEL et Rocky
install -m 0644 deploy/linux/nginx-tick.conf /etc/nginx/conf.d/tick.conf

nginx -t && systemctl reload nginx
```

Remplacer `server_name` par le nom réel, puis poser le certificat — `certbot
--nginx` ajoute le bloc TLS au fichier existant.

L'interface et l'API sont servies sous la **même origine**, à dessein : le
cookie de session est `httpOnly` et `SameSite`, et ne voyagerait pas entre deux
domaines.

## 11. Vérification

```bash
curl -fsS http://127.0.0.1:3000/api/health
systemctl is-active tick-api nginx postgresql redis-server
```

Puis ouvrir l'interface dans un navigateur et se connecter avec le compte créé à
l'étape 8. Se contenter de la route de santé ne prouve pas grand-chose : elle
répond avant que le cloisonnement et les droits aient servi.

## 12. Mise à jour

```bash
systemctl stop tick-api

VERSION=0.2.0
cd /tmp
curl -fLO https://github.com/tick0001/tick/releases/download/v$VERSION/tick-api-$VERSION-linux-x64.tar.gz
curl -fLO https://github.com/tick0001/tick/releases/download/v$VERSION/tick-web-$VERSION.tar.gz

# Remplacement, et non superposition : une archive décompressée par-dessus la
# précédente laisse en place les fichiers que la nouvelle version a supprimés.
rm -rf /opt/tick/api && mkdir -p /opt/tick/api
tar xzf tick-api-$VERSION-linux-x64.tar.gz -C /opt/tick/api
rm -rf /var/www/tick && mkdir -p /var/www/tick
tar xzf tick-web-$VERSION.tar.gz -C /var/www/tick

cd /opt/tick/api
DATABASE_URL='postgres://tick:MOT_DE_PASSE@127.0.0.1:5432/tick' \
  node node_modules/@tick/db/dist/migrate.js

systemctl start tick-api
```

Sauvegarder la base **avant** de migrer : les migrations ne se rejouent pas à
l'envers.

## 13. Sauvegarde

Trois choses à sauvegarder, et il en faut trois :

```bash
# La base
su - postgres -c "pg_dump -Fc tick" > /sauvegardes/tick-$(date +%F).dump

# Les pièces jointes
tar czf /sauvegardes/storage-$(date +%F).tar.gz -C /var/lib/tick storage
```

Et `ENCRYPTION_KEY`, **ailleurs que les deux précédentes**. Une sauvegarde
complète de la base sans la clé laisse les secrets d'annuaire et de collecteur
illisibles ; la clé rangée à côté de la base annule l'intérêt de les avoir
chiffrés.

## Diagnostic

```bash
journalctl -u tick-api -f              # journal de l'API
journalctl -u tick-api -p err --since today
systemctl cat tick-api                 # unité effective, surcharges comprises
```

| Symptôme                                         | Cause la plus fréquente                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `permission denied to create role` en migrant    | Le rôle propriétaire n'a pas `CREATEROLE` (étape 3)                     |
| `Invalid ELF header` ou module natif introuvable | Archive musl sur une distribution glibc, ou l'inverse (étape 4)         |
| 502 depuis nginx, API en marche                  | SELinux : `setsebool -P httpd_can_network_connect 1`                    |
| Téléversement refusé en écriture                 | `ReadWritePaths` de l'unité ne couvre pas `STORAGE_PATH`                |
| `ENCRYPTION_KEY` refusée au démarrage            | Elle doit faire 64 caractères hexadécimaux, pas 32                      |
| Aucune escalade, aucun courriel                  | Redis injoignable — l'API démarre quand même, les files ne tournent pas |

Le [guide d'exploitation](14-installation.md) couvre les plugins et la
description de l'API, qui ne dépendent pas du mode d'installation.
