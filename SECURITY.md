# Politique de sécurité

> **In English.** To report a vulnerability, use GitHub's private reporting on this
> repository — **Security → Report a vulnerability**. Please do not open a public issue for
> anything exploitable. Reports in English are welcome.

## Signaler une faille

Utilisez le **signalement privé de GitHub**, sur l'onglet _Security_ du dépôt → _Report a
vulnerability_. La discussion reste invisible jusqu'à publication d'un correctif.

N'ouvrez pas d'issue publique pour quelque chose d'exploitable : le dépôt est public, la
démonstration aussi, et une issue est indexée dans la minute.

Sans compte GitHub, écrivez à **tick0001@proton.me**. Le signalement par l'onglet _Security_
reste préférable : il crée l'avis, suit le correctif et publie la divulgation tout seul.

Ce qui aide à traiter vite : la version affichée par `GET /api/health`, le mode
d'installation, et la manière de reproduire. Une preuve de concept, même approximative, vaut
mieux qu'une description prudente.

## Versions suivies

Seule la dernière version étiquetée reçoit des correctifs. Le projet n'a pas encore de
branche de maintenance, et prétendre le contraire serait une promesse qu'il ne tiendrait pas.

## Ce qui est connu, et assumé

Un projet qui prétend n'avoir aucune limite en cache. Voici les siennes.

**Le rebinding DNS n'est pas couvert.** `ALLOW_PRIVATE_OUTBOUND=false` refuse les hôtes qui
résolvent vers un réseau interne, à l'enregistrement puis avant chaque connexion. Mais rien
n'empêche un nom de pointer vers une adresse publique à la validation et une adresse privée à
la connexion : s'en prémunir demanderait d'épingler l'adresse résolue jusqu'à l'ouverture du
socket, ce que ni `ldapts` ni `imapflow` n'exposent.

**Un administrateur est de confiance par défaut.** Il peut faire émettre au serveur des
connexions sortantes — annuaires LDAP, collecteurs de courriel. C'est le comportement normal
d'un outil d'administration, et `ALLOW_PRIVATE_OUTBOUND=false` existe pour les déploiements
où ce compte est distribué plus largement que la confiance.

**Le mot de passe du rôle applicatif est public à l'installation.** La migration initiale
crée `tick_app` avec un mot de passe écrit dans ce dépôt. Sa rotation est **obligatoire** et
documentée dans le [guide d'installation](docs/14-installation.md) ; tant qu'elle n'est pas
faite, quiconque atteint le port PostgreSQL entre avec un mot de passe connu de tous.

**Aucun audit externe.** Le cloisonnement entre entités est vérifié par des tests
d'intégration sur une vraie base, et les portées de droits par d'autres. Personne d'extérieur
n'a essayé de les contourner.

## Ce sur quoi le projet ne transige pas

Le cloisonnement multi-organisation repose sur le Row-Level Security de PostgreSQL, et non
sur des conditions applicatives. Une correction qui contourne ce mécanisme pour aller plus
vite sera refusée, même si elle passe les tests : c'est le filet qui rattrape le contrôleur
qui oublie sa vérification — et cela s'est déjà produit dans ce dépôt.
