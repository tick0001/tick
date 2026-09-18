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

- **La propagation des chemins avait cessé d'atteindre vingt tables, depuis la 0.1.12.** En
  ajoutant les acteurs à `entities_propagate_path()`, le corps de la fonction a été repris d'une
  migration trop ancienne, et sa liste de cibles est retombée de trente-cinq tables à quinze.
  Après un déplacement d'entité, les problèmes, les changements, les engagements, les règles, la
  base de connaissances, les formulaires, les tableaux de bord et le reste gardaient l'ancien
  chemin : le cloisonnement les laissait **visibles depuis la branche d'origine et invisibles
  depuis la nouvelle**, sans aucune erreur. La liste n'est plus écrite à la main — elle est
  déduite des tables qui portent un chemin —, et deux tests l'exigent désormais exhaustive.

### Changé

- **Un `$n` dans une requête de plugin n'est un paramètre que s'il en est un.** `SELECT 'coûte
$10'` y voyait le dixième paramètre : la requête partait amputée de son texte, ou échouait sur
  un décompte d'arguments que rien n'expliquait. Les littéraux, les identifiants entre
  guillemets, les blocs `$$…$$` et les commentaires sont désormais traversés sans y rien
  chercher.
- **Le guide d'installation dit d'où viennent les en-têtes de sécurité**, et comment vérifier
  qu'on les a : ils sont posés par le serveur qui sert l'interface, donc absents d'une
  installation qui la sert autrement, sans que rien ne le signale.
- **La documentation chiffre le coût d'un déplacement d'entité** : une seule transaction, qui
  réécrit trente-six tables pour l'entité et toute sa descendance — de 1,6 s à une cinquantaine
  de secondes à cinq cent mille tickets.

### À faire en montant

Une migration. Elle **remet d'aplomb les chemins déjà faussés** : si vous avez déplacé une entité
sous la 0.1.12, ses objets retrouvent leur place, et la migration dit lesquels elle a corrigés.
Elle ne touche rien là où rien n'a bougé. Aucune action de votre part.

Si vous exploitez la 0.1.12 et que vous avez déplacé une entité, montez sans attendre : les
objets concernés sont, en attendant, visibles du mauvais côté de l'arbre.

## [0.1.12] — 18 septembre 2026

### Sécurité

- **Le type d'une pièce jointe n'était vérifié que sur ce qu'annonçait l'expéditeur.** Un SVG,
  qui porte du script, passait pour une image PNG. Le contenu doit maintenant correspondre au
  type annoncé ; les pièces jointes des courriels collectés sont soumises à la même règle.
- **Les écritures venues d'un autre site sont refusées.** L'API vérifie l'origine qu'annonce le
  navigateur, en plus du cookie `SameSite`.
- **Le rôle applicatif ne lit plus les condensats de mots de passe**, ni les annuaires, ni l'état
  des extensions. Il est aussi celui du SQL des plugins. Voir la liste des tables concernées dans
  [la sécurité des entités](docs/03-entites-droits-securite.md#les-tables-sans-politique).
- **Les membres d'un groupe ne se gèrent plus que depuis l'entité du groupe.** Une filiale
  ajoutait des membres à un groupe récursif de la maison mère, qu'elle ne pouvait pas modifier.

### Corrigé

- **Déplacer une entité qui portait un objet de configuration échouait.** Un seul groupe, une
  seule catégorie suffisaient. Déplacer une catégorie dont la descendance vivait dans une autre
  entité échouait de même, et une descendance que l'auteur du déplacement ne voyait pas gardait
  son ancien chemin, sans erreur.

### Changé

- **Les plugins échappent à l'AGPL.** Un plugin qui n'utilise que l'interface d'extension publiée
  se distribue désormais sous la licence de son auteur, privatrice comprise : permission
  additionnelle au titre de l'article 7 de la GPL, dans
  [EXCEPTION-PLUGINS.md](EXCEPTION-PLUGINS.md), qui en donne les trois conditions et leurs
  limites. Le cœur reste sous AGPL sans exception, clause réseau comprise.
- **Le README dit d'abord ce que Tick& fait de singulier** : plusieurs organisations dans une
  seule installation, cloisonnées par la base elle-même. La liste des modules vient après.
- **Les statistiques tiennent le grand volume.** À cinq cent mille tickets, la répartition par
  technicien ou par groupe demandait vingt secondes et la courbe d'activité trois ; l'une et
  l'autre tiennent maintenant sous la seconde. La première parce que la politique de sécurité
  des acteurs allait chercher l'objet porteur à chaque ligne lue — elle compare désormais un
  chemin, comme partout ailleurs —, la seconde parce qu'elle rebouclait sur tous les tickets
  pour chacun des trente et un jours. Le premier correctif vaut pour toute lecture en nombre des
  acteurs, pas seulement pour les statistiques.
- **Une session n'est plus réécrite à chaque requête**, mais au plus toutes les cinq minutes.
- **La documentation dit ce qu'est l'installation d'un plugin** : lui accorder les droits du
  processus de l'API, accès à la base en propriétaire compris.

### À faire en montant

Trois migrations. Deux sont sans délai : la propagation des chemins et les droits du rôle
applicatif sur les tables globales. Un plugin tiers qui lisait, par `context.db`, les comptes
avec leur condensat, les annuaires ou la table des extensions reçoit désormais un refus.

La troisième réécrit la table des acteurs, qui compte une ligne par personne ou groupe rattaché
à un ticket. Comptez environ trois minutes par demi-million d'acteurs sur une machine de
développement, table verrouillée pendant ce temps : prévoyez une fenêtre si l'installation
compte plusieurs centaines de milliers de tickets. Un plugin tiers qui écrivait directement dans
`itil_actors` n'a rien à changer : le chemin d'entité est déduit de l'objet, jamais fourni par
l'écriture.

Derrière un relais qui réécrit l'en-tête `Host`, vérifier que `WEB_URL` est exacte : les
écritures depuis l'interface en dépendent désormais.

## [0.1.11] — 17 septembre 2026

### Sécurité

- **Les tentatives de connexion n'étaient pas limitées.** On pouvait essayer des mots de passe
  sans fin et, chaque vérification étant volontairement coûteuse, saturer le serveur par une
  simple rafale. Après cinq échecs, un compte est bloqué une minute, puis deux, quatre… jusqu'à
  un quart d'heure ; une adresse est refusée après vingt échecs en un quart d'heure. Le refus
  précède la vérification du mot de passe. Voir le
  [guide d'exploitation](docs/14-installation.md#connexion-et-en-têtes-de-sécurité).
- **Les pages de l'interface partaient sans protection contre l'incrustation.** Dans nginx, une
  `location` qui pose ses propres en-têtes perd ceux du serveur : les pages et les fichiers
  statiques étaient servis sans `X-Frame-Options`, et un site tiers pouvait afficher Tick& dans
  un cadre. Les en-têtes sont rétablis partout, avec une politique de contenu stricte, et HSTS
  derrière un relais HTTPS. Cela vaut pour l'image `web`, le site nginx et le `web.config`
  fournis pour les installations sans conteneur.
- **Les valeurs des requêtes de plugins étaient recopiées dans le texte SQL**, échappées à la
  main. Sur un serveur où `standard_conforming_strings` est désactivé, une valeur venue d'un
  ticket pouvait devenir du SQL. Elles partent désormais en paramètres liés.

### Corrigé

- **PostgreSQL compilait chaque requête avant de la jouer.** Le cloisonnement par entité lui
  fait surestimer le coût des requêtes, et au-delà d'un seuil il les compile — à chaque
  exécution. La recherche dans la base de connaissances en perdait 750 ms sur 800. La
  compilation est désormais coupée pour le trafic de l'application : à cinq cent mille tickets,
  la liste, la liste filtrée et le détail d'un ticket supportent 40 à 60 % de requêtes en plus,
  et aucun écran ne ralentit.
- **Les lecteurs d'écran lisaient l'aide d'un champ comme une partie de son nom.** « Mot de passe,
  laisser vide pour conserver l'actuel » était annoncé à chaque passage sur le champ, sans qu'on
  puisse distinguer le nom de la consigne. L'aide est désormais reliée comme description : le
  nom est annoncé seul, l'aide ensuite. Cela vaut pour tous les formulaires.
- **Sans conteneur, les plugins étaient cherchés hors de l'installation.** Les guides Linux et
  Windows ne réglaient pas `PLUGINS_PATH`, dont la valeur par défaut se résout au-dessus du code
  compilé : `/opt/plugins`, `C:\plugins`. Un plugin déposé ailleurs n'apparaissait jamais. Les
  guides le règlent désormais sur `/opt/tick/plugins` et `C:\Tick\plugins`, hors du dossier que
  la mise à jour remplace.

### Ajouté

- **Les plugins maintenus avec Tick& sont joints à chaque version**, dans
  `tick-plugins-<version>.tar.gz` — aujourd'hui `messagerie`. Une installation par Docker n'avait
  jusqu'ici aucun moyen de l'obtenir sans construire le dépôt. L'archive se décompresse dans le
  dossier des plugins ; rien n'est installé tant qu'un administrateur ne l'a pas décidé. Voir le
  [guide d'exploitation](docs/14-installation.md#plugins-publiés).
- **`TRUST_PROXY`** désigne les relais dont l'API croit l'adresse du client. Le défaut, les
  réseaux privés, convient au déploiement par Docker comme aux installations fournies.

### À faire en montant

Aucune migration. Par Docker, tirer les nouvelles images suffit : les en-têtes de sécurité
arrivent avec l'image `web`.

Sans conteneur, pour déposer des plugins : ajouter `PLUGINS_PATH` au fichier de configuration,
avec un chemin absolu hors du dossier de l'API, et créer ce dossier.

Sans conteneur, remplacer le site nginx ou le `web.config` par ceux de cette version : ce sont
eux qui portent les en-têtes de sécurité. Derrière un relais dont l'adresse est publique,
renseigner `TRUST_PROXY`.

## [0.1.10] — 17 septembre 2026

### Corrigé

- **Le guide d'installation Windows produisait des sauvegardes impossibles à restaurer.**
  `pg_dump … > fichier` passe, sous Windows PowerShell 5.1 — celui livré avec Windows —, par un
  flux texte réencodé : le fichier obtenu est refusé par `pg_restore`. Le guide utilise
  désormais `pg_dump -f`, qui écrit le fichier lui-même quel que soit le shell.

  **Si vous avez suivi ce guide, vérifiez vos sauvegardes** avec `pg_restore -l` : si la
  commande les refuse, refaites-en une avec la nouvelle commande.

- **La sonde de santé restait au vert quand le rôle applicatif ne pouvait plus se connecter.**
  Elle n'interrogeait la base que par le rôle propriétaire, alors que tout le trafic passe par
  `tick_app`. Un mot de passe applicatif mal reporté après sa rotation donnait une installation
  qui se déclarait saine et refusait chaque requête — sans que Compose ne redémarre rien. La
  sonde interroge désormais la base par les deux rôles.
- **Un texte mal encodé était enregistré abîmé, sans erreur.** Un client qui envoyait du
  Windows-1252 en l'annonçant comme de l'UTF-8 — `curl` sous Git Bash pour Windows, par exemple
  — voyait chaque accent remplacé par « � », et la requête réussissait : « 2e étage » devenait
  « 2e �tage », sans retour possible. Un tel corps est désormais refusé, avec un message qui dit
  quoi vérifier.
- **Un échec d'extension pouvait renvoyer les notifications en double.** Quand un plugin
  échouait sur un événement, la file rejouait l'événement entier : chaque abonné repassait,
  courriels de notification compris. Seuls les abonnés en échec sont désormais rappelés.
- **La recherche dans les tickets balayait toute la table.** Sous Row-Level Security,
  PostgreSQL ne peut utiliser aucun index pour une recherche textuelle — ni `ILIKE`, ni la
  recherche plein texte. À cinq cent mille tickets, chercher un mot prenait plus d'une
  demi-seconde et plafonnait à quatre requêtes par seconde. La recherche interroge désormais un
  index trigramme sans rien céder du cloisonnement : de 19 à 50 ms, et de 74 à 151 requêtes par
  seconde selon que le terme est rare ou fréquent. Les résultats sont identiques. Cela vaut pour
  la recherche multicritères, son export, et la recherche rapide de la liste.
- **Un plugin qui refusait une opération finissait désactivé.** Un refus — un titre de ticket
  trop court, par exemple — comptait comme une panne : au troisième, le plugin était éteint, et
  chaque refus parvenait à l'utilisateur comme une erreur interne. Un refus déclaré par
  `PluginRefusal` est maintenant une erreur de saisie, qui ne compte pas ; seules trois pannes
  **consécutives** désactivent un plugin.
- **Une activation manquée laissait un plugin à moitié actif.** Si un plugin échouait au milieu
  de son enregistrement, ce qu'il avait déjà posé restait en service, et l'écran le disait actif.
  L'activation est désormais tout ou rien : un échec retire tout et passe le plugin en erreur,
  avec sa cause. Un plugin devenu incompatible après une montée de version est refusé au
  redémarrage au lieu d'être chargé, et un plugin désactivé après des pannes ne garde plus ses
  critères de recherche ni ses widgets.
- **Les interfaces de plugins ne se chargeaient que pour les administrateurs.** Leur chargement
  passait par la liste d'administration des plugins, qu'un technicien ne peut pas lire.

### Ajouté

- **Une procédure de restauration**, pour les trois modes d'installation. Le guide expliquait
  comment sauvegarder, jamais comment restaurer — et la restauration a deux pièges : recréer le
  rôle applicatif avant, parce que `pg_dump` ne sauvegarde pas les rôles, et arrêter à la
  première erreur, sans quoi `pg_restore` produit une installation dont les données sont là mais
  où aucune connexion n'aboutit.
- **La montée de version et la restauration sont vérifiées à chaque modification.** La dernière
  version publiée est amorcée, montée vers le nouveau code, puis détruite et restaurée depuis sa
  sauvegarde ; chaque table doit garder toutes ses lignes. `make montee` joue la même chose sur
  un poste.
- **Un écran pour les extensions**, sous **Réglages › Extensions**. Il montre ce que chaque plugin
  demande avant qu'on l'installe, son état et sa dernière erreur, et pilote son cycle de vie —
  qui ne passait jusqu'ici que par des appels directs à l'API.
- **Des réglages pour les plugins.** Un plugin les déclare ; l'écran les affiche, par instance ou
  par entité, avec héritage de l'entité mère. Les secrets sont chiffrés et jamais réaffichés.
- **Le plugin `messagerie`**, livré dans le dépôt : il annonce les nouveaux tickets, les
  escalades et les résolutions dans un canal Mattermost, Slack, Rocket.Chat, Discord ou
  Microsoft Teams, avec un canal par entité. Il n'est pas inclus dans l'image : voir
  [son README](plugins/messagerie/README.md) pour le construire et le déposer.
- **SDK de plugins `0.8.0`** : réglages, requêtes sortantes soumises à
  `ALLOW_PRIVATE_OUTBOUND`, adresse de l'interface pour composer des liens, et `PluginRefusal`.

### Changé

- **`ALLOW_PRIVATE_OUTBOUND` s'applique aussi aux plugins**, pour les requêtes qu'ils émettent
  par le client du SDK.
- **Un plugin qui propose des widgets doit déclarer la permission `dashboards`.** Sans elle, son
  activation échoue et l'écran des extensions dit pourquoi.

### À faire en montant

Deux migrations. La première construit deux index sur les tickets : trois secondes chacun à cinq
cent mille tickets, pendant lesquelles les écritures sur les tickets attendent. La seconde crée la
table des réglages de plugins, sans délai. Comme toute migration, elles se jouent à l'arrêt de
l'API — ce que fait déjà le service `migrate`.

Un plugin tiers écrit pour le SDK `0.7` est refusé au redémarrage — en `0.x`, chaque version
mineure peut rompre — et passe en erreur dans l'écran des extensions. Il reprend une fois qu'il
demande `^0.8.0` ; s'il appelle `dashboards.registerWidget`, il doit aussi ajouter `dashboards` à
ses `permissions`. Un plugin qui refuse des opérations en levant une erreur ordinaire continue de
fonctionner, mais chaque refus compte comme une panne tant qu'il n'utilise pas `PluginRefusal`.

## [0.1.9] — 10 septembre 2026

### Corrigé

- **La liste des tickets s'effondrait sur les grandes installations.** Pour afficher le nom de
  l'entité, la requête joignait la table des entités — ce qui interdisait au planificateur
  d'utiliser l'index de tri : il assemblait toutes les lignes visibles avant d'en garder
  cinquante. À cinquante mille tickets, l'écran le plus ouvert du produit passait de 95 ms à
  31 ms une fois la jointure remplacée par une lecture ciblée. Aucun changement de
  comportement : les lignes affichées sont exactement les mêmes.

- **La recherche par statut ou par type balayait toute la table.** Le champ était comparé après
  conversion en texte, ce qui rendait tout index inutilisable. À cinq cent mille tickets, une
  recherche filtrée sur le statut passait de 406 ms à 22 ms. Les résultats sont inchangés, et une
  valeur invalide est toujours refusée.

### Changé

- **PostgreSQL est désormais lancé avec `random_page_cost=1.1`.** Sa valeur par défaut, `4`,
  suppose un disque à plateaux où une lecture au hasard coûte quatre fois une lecture
  séquentielle ; sur un SSD elle pousse le planificateur à balayer des tables entières plutôt
  qu'à suivre un index. Mesuré à cinquante mille tickets et cinquante connexions simultanées,
  les six scénarios du banc d'essai gagnent entre 25 % et 145 % de débit, aucun ne régresse.

  **Si vos données vivent sur un disque à plateaux**, retirez la ligne `command:` du service
  `postgres` de votre fichier Compose : la valeur par défaut est alors la bonne. C'est le seul
  paramètre PostgreSQL que Tick& règle pour vous.

## [0.1.8] — 10 septembre 2026

### Corrigé

- **Le catalogue servait le nom d'origine à un lecteur anglophone.** La traduction du nom d'un
  formulaire s'appliquait à l'ouverture, mais pas dans la liste où le demandeur choisit : il
  parcourait une liste dans une langue, cliquait, et le titre changeait de langue. C'est
  pourtant le seul endroit où ce nom lui sert.
- **Un mot de passe faux n'affichait aucun message.** L'écran de connexion restait muet : qui
  se trompait n'avait aucune indication, et pouvait croire l'application en panne.
- **`pnpm db:seed` échouait au deuxième passage.** La table des traductions de formulaires est
  polymorphe, donc sans clé étrangère : la remise à zéro ne l'atteignait pas, et ses lignes
  survivantes heurtaient les identifiants recréés. Sans conséquence sur une installation en
  service — l'amorçage ne sert qu'à monter un jeu de démonstration.
- Le formulaire de création de compte annonce la longueur minimale du mot de passe, au lieu de
  la refuser après coup sur un « Données invalides » qui ne disait pas quel champ corriger.

### À faire en montant

Rien. Aucune de ces corrections ne touche à la configuration ni aux données.

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

[0.1.12]: https://github.com/tick0001/tick/releases/tag/v0.1.12
[0.1.11]: https://github.com/tick0001/tick/releases/tag/v0.1.11
[0.1.10]: https://github.com/tick0001/tick/releases/tag/v0.1.10
[0.1.9]: https://github.com/tick0001/tick/releases/tag/v0.1.9
[0.1.8]: https://github.com/tick0001/tick/releases/tag/v0.1.8
[0.1.7]: https://github.com/tick0001/tick/releases/tag/v0.1.7
[0.1.6]: https://github.com/tick0001/tick/releases/tag/v0.1.6
[0.1.5]: https://github.com/tick0001/tick/releases/tag/v0.1.5
[0.1.4]: https://github.com/tick0001/tick/releases/tag/v0.1.4
[0.1.3]: https://github.com/tick0001/tick/releases/tag/v0.1.3
[0.1.2]: https://github.com/tick0001/tick/releases/tag/v0.1.2
[0.1.1]: https://github.com/tick0001/tick/tree/v0.1.1
[0.1.0]: https://github.com/tick0001/tick/tree/v0.1.0
