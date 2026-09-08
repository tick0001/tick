# Installation sur Windows Server, sans conteneur

Ce document décrit une installation de production sur Windows Server. C'est le
chemin à suivre quand l'organisation n'exploite pas de serveurs Linux, ou quand
la politique interdit un moteur de conteneurs.

## Ce qui est vérifié, et ce qui ne l'est pas

Autant le dire avant que vous n'y passiez une soirée.

**Vérifié**, sur Windows, avec l'archive `win-x64` réellement produite : les
migrations s'appliquent, la création du premier administrateur fonctionne, l'API
démarre, répond sur sa route de santé, et une connexion aboutit. Le module natif
`@node-rs/argon2` est bien fourni en version `win32-x64-msvc` dans l'archive, et
la configuration par fichier `.env` fonctionne sans aucune variable
d'environnement.

**Non vérifié** faute de machine de test : l'installeur PostgreSQL d'EDB,
l'enregistrement du service Windows, et la configuration IIS. Ces étapes sont
écrites d'après la documentation de leurs éditeurs respectifs, pas d'après une
exécution. Si l'une d'elles vous résiste, c'est utile à
[signaler](https://github.com/tick0001/tick/issues).

L'[installation Linux](16-installation-linux.md), elle, a été déroulée
intégralement sur une machine vierge.

## Le point à trancher avant tout : Redis

**Redis n'a pas de version Windows officielle**, et il n'est pas optionnel ici :
six files en dépendent — envoi de courriel, collecte entrante, récurrences,
événements de plugins, enquêtes de satisfaction et **escalade des engagements de
service**. Sans Redis, pas de SLA.

Trois options réelles :

| Option                          | Ce que ça coûte                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Un Redis existant du réseau** | Rien. `REDIS_URL` pointe où vous voulez, y compris sur un hôte Linux.                             |
| **Memurai**                     | Compatible Redis, natif Windows, service inclus. Licence payante en production.                   |
| **WSL2**                        | Le vrai Redis. Mais une politique qui interdit Docker interdit souvent WSL2, pour la même raison. |

En entreprise, la première est souvent la plus propre : l'application sous
Windows, Redis sur l'infrastructure Linux déjà en place et déjà supervisée.

**À écarter formellement** : le portage Windows de Redis publié par Microsoft.
Il est archivé, figé en 3.0.504 depuis 2016, et BullMQ ne fonctionnera pas
dessus — il s'appuie sur des commandes et des scripts que cette version n'a pas.
Le symptôme est une erreur obscure au premier travail mis en file, pas un refus
au démarrage.

## Ce qu'il faut

| Composant      | Version                 | Rôle                                 |
| -------------- | ----------------------- | ------------------------------------ |
| Windows Server | 2019 ou plus            | Système                              |
| Node.js        | 22 ou 24                | Exécution de l'API                   |
| PostgreSQL     | 18                      | Données, et le cloisonnement par RLS |
| Redis          | 7 ou plus               | Files de travaux (voir ci-dessus)    |
| IIS            | avec URL Rewrite et ARR | Sert l'interface et relaie l'API     |

Tick& n'expose **pas** de TLS lui-même : le certificat se pose sur IIS, ou sur
le répartiteur en amont.

## 1. Node.js et PostgreSQL

```powershell
winget install OpenJS.NodeJS.LTS
winget install PostgreSQL.PostgreSQL.18
```

À défaut de `winget` — fréquent sur un serveur durci —, les installeurs MSI de
[nodejs.org](https://nodejs.org) et de
[EDB](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)
font la même chose.

L'installeur d'EDB inclut les modules _contrib_, dont dépendent les quatre
extensions requises : `citext`, `ltree`, `pg_trgm` et `unaccent`. Ne pas
décocher « Command Line Tools » : `psql` sert aux étapes suivantes.

## 2. Arborescence

```powershell
New-Item -ItemType Directory -Force C:\Tick\api      # code de l'API
New-Item -ItemType Directory -Force C:\Tick\web      # interface, servie par IIS
New-Item -ItemType Directory -Force C:\Tick\config   # configuration et secrets
New-Item -ItemType Directory -Force C:\Tick\storage  # pièces jointes
```

La configuration est **hors** du dossier du code, à dessein : la mise à jour
remplace `C:\Tick\api` en entier, et une configuration rangée dedans
disparaîtrait avec.

## 3. Compte de service

L'API tourne sous un compte dédié plutôt que sous `LocalSystem` : un service de
ticketing n'a aucun besoin des droits d'administration de la machine.

```powershell
$motdepasse = Read-Host -AsSecureString "Mot de passe du compte de service"
New-LocalUser -Name 'tick' -Password $motdepasse -PasswordNeverExpires -UserMayNotChangePassword

# Le compte doit pouvoir écrire les pièces jointes, et lire sa configuration.
icacls C:\Tick\storage /grant 'tick:(OI)(CI)M'
icacls C:\Tick\config  /grant 'tick:(OI)(CI)R'
```

Le droit « Ouvrir une session en tant que service » s'accorde dans
`secpol.msc` → Stratégies locales → Attribution des droits utilisateur, ou
directement par l'outil d'enregistrement du service à l'étape 7.

## 4. Base de données

```powershell
$env:PGPASSWORD = 'le-mot-de-passe-postgres'
psql -U postgres -c "CREATE ROLE tick LOGIN CREATEROLE PASSWORD 'un-mot-de-passe-solide'"
psql -U postgres -c "CREATE DATABASE tick OWNER tick"
```

**`CREATEROLE` n'est pas décoratif.** La migration initiale crée le rôle
applicatif `tick_app`, et sans cet attribut elle échoue sur
`permission denied to create role`, après avoir déjà appliqué une partie du
schéma.

Sur une base gérée où `CREATEROLE` n'est pas accordable, créez `tick_app`
vous-même avant de migrer — la migration le laisse en place s'il existe déjà :

```sql
CREATE ROLE tick_app LOGIN PASSWORD 'un-autre-mot-de-passe-solide';
```

## 5. Archives de version

Les archives sont attachées à chaque [version publiée](https://github.com/tick0001/tick/releases).
Elles sont autonomes : code compilé et dépendances incluses. Le serveur n'a donc
besoin ni de pnpm, ni d'un compilateur, ni du dépôt.

```powershell
$version = '0.1.0'
$base = "https://github.com/tick0001/tick/releases/download/v$version"

Invoke-WebRequest "$base/tick-api-$version-win-x64.zip" -OutFile "$env:TEMP\api.zip"
Invoke-WebRequest "$base/tick-web-$version.tar.gz"      -OutFile "$env:TEMP\web.tar.gz"

tar -xf "$env:TEMP\api.zip"    -C C:\Tick\api
tar -xzf "$env:TEMP\web.tar.gz" -C C:\Tick\web
```

`tar` est fourni avec Windows depuis la version 1803 : rien à installer. Il sert
ici pour les deux archives, y compris le `.zip` — `Expand-Archive` fonctionne
mais met plusieurs minutes sur les dizaines de milliers de fichiers de
l'arborescence, là où `tar` rend la main en quelques secondes.

Prendre l'archive **`win-x64`** et non `linux-x64` : `@node-rs/argon2` est un
module natif, et le binaire n'est pas le même. Une archive Linux déposée ici
échoue au démarrage sur un module introuvable.

## 6. Configuration

L'API lit un fichier `.env` depuis son répertoire de travail. Aucune variable
d'environnement n'est nécessaire — ce qui évite d'écrire des secrets dans la
configuration du service, où ils seraient lisibles par tout administrateur.

Créer `C:\Tick\config\.env` :

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

STORAGE_PATH=C:\Tick\storage

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=assistance@exemple.fr

DEFAULT_LOCALE=fr
LOG_LEVEL=log
```

Générer les deux secrets :

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

`ENCRYPTION_KEY` doit faire exactement 32 octets en hexadécimal, soit 64
caractères. La perdre rend définitivement illisibles les mots de passe
d'annuaire et de collecteur stockés en base : à sauvegarder **à part** de la
base, sans quoi une sauvegarde compromise livre les deux d'un coup.

Restreindre le fichier, qui porte désormais tous les secrets :

```powershell
icacls C:\Tick\config\.env /inheritance:r /grant 'Administrators:R' /grant 'tick:R'
```

## 7. Migrations et premier administrateur

```powershell
Set-Location C:\Tick\config   # pour que le .env soit lu

$env:DATABASE_URL = 'postgres://tick:MOT_DE_PASSE@127.0.0.1:5432/tick'
node C:\Tick\api\node_modules\@tick\db\dist\migrate.js
```

Puis faire tourner le mot de passe du rôle applicatif. La migration crée
`tick_app` avec un mot de passe par défaut, **écrit dans le dépôt public** :

```powershell
psql -U postgres -d tick -c "ALTER ROLE tick_app PASSWORD 'le-nouveau'"
```

Reporter le même mot de passe dans `DATABASE_APP_URL`, puis créer le premier
administrateur — sans lui, l'installation est migrée mais personne ne peut y
entrer :

```powershell
$env:TICK_ADMIN_PASSWORD = '…'
node C:\Tick\api\dist\cli\initialiser.js
```

La commande refuse de s'exécuter si un compte existe déjà : elle ne peut pas
écraser une installation en service.

## 8. Service Windows

Node n'est pas un exécutable de service : Windows le démarrerait puis le tuerait
faute de réponse au gestionnaire de services. Il lui faut un enveloppeur.

### Avec NSSM

```powershell
nssm install Tick-API "C:\Program Files\nodejs\node.exe" "--enable-source-maps C:\Tick\api\dist\main.js"
nssm set Tick-API AppDirectory C:\Tick\config
nssm set Tick-API DisplayName "Tick& — API"
nssm set Tick-API Start SERVICE_AUTO_START
nssm set Tick-API ObjectName .\tick "le-mot-de-passe-du-compte"
nssm set Tick-API AppStdout C:\Tick\logs\api.log
nssm set Tick-API AppStderr C:\Tick\logs\api-erreurs.log

# Redémarrage automatique, et attente avant de réessayer plutôt qu'une boucle
# serrée qui masquerait la cause dans le journal.
nssm set Tick-API AppExit Default Restart
nssm set Tick-API AppRestartDelay 5000

Start-Service Tick-API
```

`AppDirectory` est ce qui fait lire `C:\Tick\config\.env` : c'est le répertoire
de travail du service.

### Sans binaire tiers

Si la politique interdit d'installer NSSM, une tâche planifiée au démarrage rend
le même service, en moins fin — pas de redémarrage sur plantage :

```powershell
$action  = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' `
             -Argument '--enable-source-maps C:\Tick\api\dist\main.js' `
             -WorkingDirectory 'C:\Tick\config'
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName 'Tick-API' -Action $action -Trigger $trigger `
  -User '.\tick' -Password 'le-mot-de-passe-du-compte' -RunLevel Limited
```

## 9. IIS

Installer le rôle et les deux modules — ils ne sont pas fournis avec IIS :

```powershell
Install-WindowsFeature -Name Web-Server -IncludeManagementTools
```

Puis [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite) et
[Application Request Routing](https://www.iis.net/downloads/microsoft/application-request-routing),
téléchargés depuis iis.net.

**Activer le proxy d'ARR**, sans quoi la règle de relais est acceptée mais ne
relaie rien : gestionnaire IIS → nœud du serveur → _Application Request Routing
Cache_ → _Server Proxy Settings_ → cocher _Enable proxy_.

```powershell
New-Website -Name 'Tick' -PhysicalPath C:\Tick\web -Port 80
Copy-Item deploy\windows\web.config C:\Tick\web\web.config
```

Le fichier [`deploy/windows/web.config`](../deploy/windows/web.config) porte les
deux règles : le relais de `/api/` vers le service, et le repli sur `index.html`
pour les routes de l'interface.

Poser ensuite le certificat sur le site, et rediriger le port 80 vers le 443.

## 10. Vérification

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
Get-Service Tick-API
```

Puis ouvrir l'interface dans un navigateur et se connecter avec le compte créé à
l'étape 7. Se contenter de la route de santé ne prouve pas grand-chose : elle
répond avant que le cloisonnement et les droits aient servi.

## 11. Mise à jour

```powershell
Stop-Service Tick-API

$version = '0.2.0'
$base = "https://github.com/tick0001/tick/releases/download/v$version"
Invoke-WebRequest "$base/tick-api-$version-win-x64.zip" -OutFile "$env:TEMP\api.zip"
Invoke-WebRequest "$base/tick-web-$version.tar.gz"      -OutFile "$env:TEMP\web.tar.gz"

# Remplacement, et non superposition : une archive décompressée par-dessus la
# précédente laisse en place les fichiers que la nouvelle version a supprimés.
Remove-Item -Recurse -Force C:\Tick\api, C:\Tick\web
New-Item -ItemType Directory -Force C:\Tick\api, C:\Tick\web | Out-Null
tar -xf "$env:TEMP\api.zip"    -C C:\Tick\api
tar -xzf "$env:TEMP\web.tar.gz" -C C:\Tick\web
Copy-Item deploy\windows\web.config C:\Tick\web\web.config

Set-Location C:\Tick\config
$env:DATABASE_URL = 'postgres://tick:MOT_DE_PASSE@127.0.0.1:5432/tick'
node C:\Tick\api\node_modules\@tick\db\dist\migrate.js

Start-Service Tick-API
```

`C:\Tick\config` et `C:\Tick\storage` ne sont pas touchés — c'est tout l'intérêt
de les avoir mis hors du dossier du code.

Sauvegarder la base **avant** de migrer : les migrations ne se rejouent pas à
l'envers.

## 12. Sauvegarde

```powershell
$jour = Get-Date -Format 'yyyy-MM-dd'
pg_dump -U tick -Fc tick > "D:\Sauvegardes\tick-$jour.dump"
Compress-Archive C:\Tick\storage "D:\Sauvegardes\storage-$jour.zip"
```

Et `ENCRYPTION_KEY`, **ailleurs que les deux précédentes**. Une sauvegarde
complète de la base sans la clé laisse les secrets d'annuaire et de collecteur
illisibles ; la clé rangée à côté de la base annule l'intérêt de les avoir
chiffrés.

## Diagnostic

Les journaux sont ceux qu'on a désignés à l'étape 8 :
`C:\Tick\logs\api.log` et `api-erreurs.log`.

| Symptôme                                      | Cause la plus fréquente                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `permission denied to create role` en migrant | Le rôle propriétaire n'a pas `CREATEROLE` (étape 4)                     |
| Module natif introuvable au démarrage         | Archive `linux-x64` déposée à la place de `win-x64` (étape 5)           |
| Le service démarre puis s'arrête              | Répertoire de travail erroné : le `.env` n'est pas lu (`AppDirectory`)  |
| 404 sur `/api/...`, service en marche         | Le proxy d'ARR n'est pas activé au niveau du serveur (étape 9)          |
| Interface sans police, 404 discrètes          | Types MIME manquants — le `web.config` fourni les déclare               |
| `ENCRYPTION_KEY` refusée au démarrage         | Elle doit faire 64 caractères hexadécimaux, pas 32                      |
| Aucune escalade, aucun courriel               | Redis injoignable — l'API démarre quand même, les files ne tournent pas |

Le [guide d'exploitation](14-installation.md) couvre les plugins et la
description de l'API, qui ne dépendent pas du mode d'installation.
