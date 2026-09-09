# Journal des versions

Ce que chaque version change, et **ce qu'elle exige de vous** — une montée de version se
décide, elle ne se subit pas. Les notes générées par GitHub listent les commits ; celles-ci
disent s'il faut agir.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), le versionnage
[semver](https://semver.org/lang/fr/). Tant que le numéro majeur est `0`, une version mineure
peut rompre.

## Non publié

### Corrigé

- **La sonde de santé n'interrogeait rien.** `GET /api/health` renvoyait `ok` sans toucher à
  PostgreSQL ni Redis : un conteneur dont la base était tombée restait marqué `healthy`,
  Compose ne redémarrait rien, et la supervision restait au vert. Elle répond désormais
  **503** quand une dépendance manque, et le corps nomme laquelle.

### Ajouté

- Un [`Makefile`](Makefile) qui compose les surcouches. `make` seul liste les cibles.
- [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md),
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) et les gabarits d'issues.
- Dependabot, groupé et hebdomadaire.

### À faire en montant de version

**Le contrat de `/api/health` change** : le champ `checks` s'ajoute, et le code HTTP devient
`503` en cas de dépendance manquante. Si votre supervision lit ce point d'entrée, vérifiez
qu'elle ne considère pas un 503 comme une panne de l'API elle-même — c'en est une, mais dont
la cause est ailleurs.

## 0.1.5 — 9 septembre 2026

### Sécurité

- **Les pièces jointes suivaient l'entité, pas la portée du droit.** Le Row-Level Security
  cloisonne par entité, ce qui bloque une autre organisation mais pas un collègue de la
  même : un profil en `ticket:read:own` pouvait lister et télécharger les pièces jointes des
  tickets d'autrui. La portée se vérifie désormais sur l'objet porteur.
- **Connexions sortantes vers les réseaux internes.** Annuaires LDAP et collecteurs de
  courriel laissent choisir librement l'hôte joint par le serveur, et se déclenchent à la
  demande. `ALLOW_PRIVATE_OUTBOUND=false` refuse les plages privées, de bouclage et de
  lien-local — dont l'adresse de métadonnées des hébergeurs.

### Modifié

- La configuration nginx accepte un point d'extension, `/etc/nginx/tick-extra/*.conf`, au
  lieu d'obliger un déploiement à recopier le fichier entier.

### À faire en montant de version

`ALLOW_PRIVATE_OUTBOUND` vaut **vrai** par défaut : rien à faire pour une installation
ordinaire, où l'annuaire visé est interne et l'administrateur de confiance. Le passer à
`false` là où le compte d'administration est distribué plus largement que la confiance.

**La surcouche de démonstration exige cette version ou plus récente.** Sur une image
antérieure, ses refus d'écriture sont ignorés en silence.

## 0.1.4 — 9 septembre 2026

### Ajouté

- Le message d'accueil accepte les listes et rend les adresses cliquables. Seuls `http://` et
  `https://` sont promus, et l'adresse est reconstruite depuis ce qui a été reconnu.

## 0.1.3 — 9 septembre 2026

### Ajouté

- **Message d'accueil sur l'écran de connexion**, par `LOGIN_BANNER` — horaires du support,
  numéro d'astreinte, maintenance annoncée. Rendu comme du texte, jamais comme du HTML.
- Surcouches compose pour un Traefik déjà en place et pour une démonstration publique.

### Corrigé

- Le compose ne transmettait pas `LOGIN_BANNER` au conteneur : la renseigner n'avait aucun
  effet, sans le moindre message.

## 0.1.2 — 8 septembre 2026

### Corrigé

- **`/api/health` annonçait toujours `0.0.0`.** La version venait de `npm_package_version`,
  que ni npm ni pnpm ne renseignent quand le processus démarre par `node dist/main.js` — ce
  que font l'image et les installations nues. Elle est désormais lue dans le manifeste.
- L'archive Windows était inutilisable : `pnpm` liant chaque dépendance depuis `.pnpm/`, elle
  contenait 506 liens symboliques que Windows ne recrée pas sans mode développeur.

### Ajouté

- L'intégration continue refuse de publier si l'étiquette et le manifeste divergent.

## 0.1.1 — 8 septembre 2026

### Ajouté

- **Archives de version pour les installations sans conteneur**, une par plateforme :
  `@node-rs/argon2` est un module natif, et un `node_modules` fabriqué sur une plateforme ne
  démarre pas sur une autre.

## 0.1.0 — 7 septembre 2026

Première version étiquetée. Dix-sept modules fonctionnels, images publiées sur ghcr,
déploiement par conteneurs ou par archives, licence AGPL-3.0-or-later.

**Jamais utilisé par un vrai centre de services** — voir le [README](README.md), qui dit
franchement ce qu'il faut savoir avant de s'en servir.
