# Journal des versions

Ce que chaque version change **pour une installation**, et ce qu'elle exige de vous avant de
monter. Les notes générées par GitHub listent les commits ; celles-ci disent s'il faut agir.

Les rubriques vont du plus urgent au plus anodin — sécurité, corrections, ajouts, changements
— plutôt que dans l'ordre de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), dont le
format est repris pour le reste. Le versionnage suit
[semver](https://semver.org/lang/fr/) : tant que le numéro majeur est `0`, une version mineure
peut rompre.

Ce qui ne concerne que le dépôt — intégration continue, outillage de publication, fichiers de
communauté — n'y figure pas. Ce journal s'adresse à qui exploite Tick&, pas à qui y contribue.

## Non publié

### Corrigé

- **Le catalogue servait le nom d'origine à un lecteur anglophone.** La traduction du nom d'un
  formulaire s'appliquait à l'ouverture, mais pas dans la liste où le demandeur choisit :
  il parcourait une liste dans une langue, cliquait, et le titre changeait de langue.
- **Un mot de passe faux n'affichait aucun message.** L'écran de connexion restait muet, sans
  rien indiquer à qui s'était trompé.
- Le formulaire de création de compte annonce désormais la longueur minimale du mot de passe,
  au lieu de la refuser après coup sur un « Données invalides » qui ne disait pas quel champ.

### À faire en montant

Rien. Ces trois corrections ne changent ni configuration ni données.

## [0.1.7] — 9 septembre 2026

**Rien ne change pour une installation.** Cette version ne corrige que la publication
elle-même : la construction des images échouait par intermittence au moment de publier, et
deux fichiers d'enregistrement de construction s'étaient retrouvés joints aux archives de la
0.1.6 — depuis retirés. Si vous tournez en 0.1.6, vous pouvez sauter celle-ci.

## [0.1.6] — 9 septembre 2026

### Corrigé

- **La sonde de santé n'interrogeait rien.** `GET /api/health` répondait `ok` sans toucher à
  PostgreSQL ni Redis : un conteneur dont la base était tombée restait `healthy`, Compose ne
  redémarrait rien, la supervision restait au vert. Elle interroge désormais les deux, et
  répond **503** en nommant la dépendance qui manque.

### Ajouté

- **Les libellés de formulaires se traduisent** — nom du formulaire, titres de section,
  intitulés de question. Le demandeur voit sa langue ; l'administrateur garde la saisie
  d'origine. Sans traduction, c'est l'original qui s'affiche, jamais un libellé vide.
- Un [`Makefile`](Makefile) pour composer les surcouches sur le serveur, `make prod` et
  `make demo` plutôt que trois `-f` à taper de mémoire. `make` seul liste les cibles.
- Une [politique de sécurité](SECURITY.md), qui dit où signaler une faille sans la rendre
  publique.

### Modifié

- L'image de l'interface sert nginx 1.31.

### À faire en montant

**Le contrat de `/api/health` change** : le champ `checks` s'ajoute, et une dépendance
manquante fait répondre **503** au lieu de `200`. Si votre supervision lit ce point d'entrée,
vérifiez qu'elle n'y voit pas une panne de l'API elle-même — c'en est une, mais dont la cause
est ailleurs.

## [0.1.5] — 9 septembre 2026

### Sécurité

- **Les pièces jointes suivaient l'entité, pas la portée du droit.** Le Row-Level Security
  cloisonne par entité : il bloque une autre organisation, pas un collègue de la même. Un
  profil en `ticket:read:own` pouvait donc lister et télécharger les pièces jointes des
  tickets d'autrui. La portée se vérifie désormais sur l'objet porteur.
- **Connexions sortantes vers les réseaux internes.** Annuaires LDAP et collecteurs de
  courriel laissent choisir librement l'hôte que joint le serveur, et se déclenchent à la
  demande. `ALLOW_PRIVATE_OUTBOUND=false` refuse les plages privées, de bouclage et de
  lien-local — dont l'adresse de métadonnées des hébergeurs.

### Modifié

- La configuration nginx accepte un point d'extension, `/etc/nginx/tick-extra/*.conf`, au lieu
  d'obliger un déploiement à recopier le fichier entier.

### À faire en montant

`ALLOW_PRIVATE_OUTBOUND` vaut **vrai** par défaut : rien à faire pour une installation
ordinaire, où l'annuaire visé est interne et l'administrateur de confiance. Le passer à
`false` là où le compte d'administration est distribué plus largement que la confiance.

**La surcouche de démonstration exige cette version au minimum.** Sur une image antérieure,
ses refus d'écriture sont ignorés en silence.

## [0.1.4] — 9 septembre 2026

### Modifié

- Le message d'accueil (`LOGIN_BANNER`) accepte les listes et rend les adresses cliquables.
  Seuls `http://` et `https://` sont promus, et l'adresse est reconstruite depuis ce qui a été
  reconnu.

## [0.1.3] — 9 septembre 2026

### Corrigé

- Le compose ne transmettait pas `LOGIN_BANNER` au conteneur : la renseigner n'avait aucun
  effet, sans le moindre message.

### Ajouté

- **Message d'accueil sur l'écran de connexion**, par `LOGIN_BANNER` — horaires du support,
  numéro d'astreinte, maintenance annoncée. Rendu comme du texte, jamais comme du HTML.
- Surcouches compose pour un Traefik déjà en place, et pour une démonstration publique.

## [0.1.2] — 8 septembre 2026

### Corrigé

- **`/api/health` annonçait toujours `0.0.0`.** La version venait de `npm_package_version`,
  que ni npm ni pnpm ne renseignent quand le processus démarre par `node dist/main.js` — ce
  que font l'image comme les installations nues. Elle est désormais lue dans le manifeste.
- **L'archive Windows était inutilisable.** pnpm liant chaque dépendance depuis `.pnpm/`, elle
  contenait 506 liens symboliques que Windows ne recrée pas sans le mode développeur.

## [0.1.1] — 8 septembre 2026

### Ajouté

- **Archives de version pour les installations sans conteneur**, une par plateforme :
  `@node-rs/argon2` est un module natif, et un `node_modules` fabriqué sur une plateforme ne
  démarre pas sur une autre.

## [0.1.0] — 7 septembre 2026

Première version étiquetée. Dix-sept modules fonctionnels, images publiées sur ghcr,
déploiement par conteneurs ou par archives, licence AGPL-3.0-or-later.

**Jamais utilisé par un vrai centre de services** — voir le [README](README.md), qui dit
franchement ce qu'il faut savoir avant de s'en servir.

[0.1.7]: https://github.com/tick0001/tick/releases/tag/v0.1.7
[0.1.6]: https://github.com/tick0001/tick/releases/tag/v0.1.6
[0.1.5]: https://github.com/tick0001/tick/releases/tag/v0.1.5
[0.1.4]: https://github.com/tick0001/tick/releases/tag/v0.1.4
[0.1.3]: https://github.com/tick0001/tick/releases/tag/v0.1.3
[0.1.2]: https://github.com/tick0001/tick/releases/tag/v0.1.2
[0.1.1]: https://github.com/tick0001/tick/tree/v0.1.1
[0.1.0]: https://github.com/tick0001/tick/tree/v0.1.0
