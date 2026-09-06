# Self-service

Trois briques pour la même personne : le demandeur. Il cherche d'abord une réponse, sinon il demande,
et il suit ce qu'il a demandé. L'interface le suppose dans cet ordre.

## 1. Base de connaissances

### Deux niveaux de visibilité, à ne pas confondre

- **L'entité**, tranchée par le Row-Level Security, comme toute configuration. Un article écrit à la
  racine et marqué récursif descend dans toute l'arborescence.
- **Le ciblage fin** — profil, groupe, utilisateur — résolu dans la requête, pas dans une politique
  SQL. Il dépend des groupes de la personne connectée, que la session ne porte pas ; l'y injecter
  supposerait de les recalculer à chaque requête.

Un article **sans cible est visible de tout le périmètre**. Exiger une cible rendrait cérémonieuse
la publication d'un article ordinaire, qui est le cas courant.

Un brouillon n'est visible que de son auteur. C'est la seule exception à la règle précédente, et
elle vaut aussi pour la lecture directe : demander un article non destiné rend « introuvable », pas
« interdit » — dire qu'un article existe mais qu'il est réservé en révèle déjà l'existence.

### La FAQ publique est une publication, pas un classement

`isFaq` rend l'article lisible **sans compte**, par quiconque a l'adresse. Aucune autre règle ne
s'applique alors : il n'y a personne dont on pourrait vérifier le profil ou l'entité.

Le contrôleur public et le contrôleur authentifié partagent le même service. Une seconde
implémentation « publique » finirait par diverger, et c'est exactement là qu'une divergence
exposerait ce qui ne devait pas l'être.

### Révisions

Chaque enregistrement archive l'état **précédent**, entier. Le différentiel économiserait quelques
kilo-octets et rendrait impossible la seule question qu'on pose vraiment : que disait cet article
avant cette modification.

### Recherche

Colonne `tsvector` générée par la base — pas un déclencheur — donc toujours à jour, y compris pour
une écriture faite hors de l'application. Le titre pèse plus que le corps : un article se cherche
d'abord par son nom. Sans recherche, l'ordre est celui de la dernière mise à jour.

### Compteur de consultations

Incrémenté par la lecture, pas par `findById`. Ce dernier sert aussi à l'édition et à l'aperçu :
les compter gonflerait un chiffre censé mesurer l'usage réel.

## 2. Formulaires

### Une question se désigne par son rang

Les conditions et les correspondances citent une question par sa **position dans le formulaire**,
toutes sections confondues — jamais par un identifiant de base. La raison est concrète : on compose
un formulaire avant que ses questions existent, et une condition doit pouvoir viser une question
qu'on vient d'ajouter.

La base, elle, stocke des identifiants. La traduction se fait à la lecture, une fois pour toutes.

### Affichage conditionnel

Une question s'affiche si **toutes** ses conditions sont vraies. Une condition qui dépend d'une
question elle-même masquée est fausse : sans cela, une branche entière ressurgirait dès que sa
racine disparaît.

Le serveur n'exige de réponse qu'aux questions **visibles**. Exiger une réponse à une question
cachée produirait un refus incompréhensible : le champ manquant est invisible.

Les mêmes opérateurs servent des deux côtés — l'interface les évalue pour afficher, le serveur pour
valider. La comparaison vit dans `matchesOperator`, partagée avec le moteur de règles : deux
implémentations finiraient par ne plus répondre pareil au même opérateur.

### Destinations

La correspondance entre réponses et champs de l'objet est explicite. Deviner qu'une question
intitulée « Urgence » alimente l'urgence marcherait jusqu'au premier formulaire traduit.

Une correspondance produit du texte ; c'est `applyRuleOutput` — celui des règles — qui sait ce
qu'un champ de ticket attend, y compris quand le champ désigne un acteur et non une colonne.

Deux garde-fous quand la correspondance ne dit rien :

- **sans titre**, le ticket prend le nom du formulaire. « Demande de matériel » se lit mieux dans
  une file que la réponse à la première question ;
- **sans description**, le ticket reprend les questions et leurs réponses. Un formulaire rempli ne
  doit pas produire un ticket vide, où le technicien verrait un titre et rien d'autre.

La soumission passe par `TicketsService`, jamais par une écriture directe : un ticket né d'un
formulaire reçoit ses règles, ses engagements et son historique comme n'importe quel autre.

### Les réponses survivent au formulaire

`form_submissions` garde les réponses complètes, même celles qu'aucune correspondance ne reprend.
Sans elles, retirer une question du formulaire emporterait ce que les demandeurs y avaient répondu.

## 3. Interface simplifiée

Elle est portée par le **profil actif**, pas par l'utilisateur : la même personne peut être
technicienne sur une branche et simple demandeuse sur une autre, et l'écran doit suivre le contexte
de travail.

Un profil `self_service` voit trois entrées — catalogue, ses demandes, base de connaissances — et
arrive sur le catalogue. Les écrans de paramétrage ne sont pas grisés : ils sont absents. Les
montrer pour qu'ils refusent l'accès serait pire que les taire.

Même principe à l'intérieur d'un écran : le bouton « Nouvel article » n'apparaît que si le profil a
le droit d'écrire. Un bouton qui ne peut qu'échouer promet une action, la refuse, et laisse croire
à une panne.

## 4. Ce qui reste au jalon suivant

- Traductions des libellés de formulaire : la table existe, l'éditeur ne les propose pas encore.
- Politique d'accès aux formulaires par groupe et par utilisateur : le modèle et le filtre les
  gèrent, l'écran d'administration ne montre que le formulaire lui-même.
- Question de type fichier : la nature est réservée dans le modèle, le téléversement depuis un
  formulaire viendra avec l'écran de rédaction enrichi.
- Proposer un article comme solution depuis un ticket, et créer un article depuis une solution : le
  lien entre les deux objets existe, le geste ne s'offre pas encore dans la chronologie.
