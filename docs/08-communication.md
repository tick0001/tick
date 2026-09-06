# Communication

Trois mécanismes qui partagent une même idée : **l'application ne rédige jamais un message**. Elle
publie un événement, et un modèle décide du texte, de la langue et des destinataires. C'est ce qui
permet à une organisation de changer le ton de ses courriels sans changer de version.

## 1. Notifications

### Le destinataire est un rôle

« Le demandeur » désigne quelqu'un de différent d'un ticket à l'autre. Les rôles sont résolus au
moment de l'envoi :

| Rôle                      | Résolution                             |
| ------------------------- | -------------------------------------- |
| `requester`               | acteurs demandeurs de type utilisateur |
| `observer`                | acteurs observateurs                   |
| `assigned`                | techniciens attribués                  |
| `assigned_group`          | membres des groupes attribués          |
| `assigned_group_manager`  | responsables de ces groupes            |
| `requester_group`         | membres des groupes demandeurs         |
| `requester_group_manager` | responsables de ces groupes            |
| `author`                  | `tickets.created_by_id`                |
| `followup_author`         | `authorId` de l'événement              |
| `fixed`                   | une adresse portée par le modèle       |

Un groupe désigne des personnes, pas une adresse : un modèle qui vise le groupe attribué et
n'atteindrait personne serait un échec silencieux — la notification manquante ne se remarque que le
jour où quelqu'un attendait le courriel. C'est la raison d'être du test dédié.

`followup_author` mérite une note : l'auteur voyage dans la **charge utile de l'événement**, et non
par une relecture en base. Un abonné — un plugin, par exemple — ne peut pas deviner qui vient
d'écrire, et le contrat de plugin lui interdit justement de connaître le schéma du cœur.

### Un objet privé ne notifie que les intervenants

Quand la charge utile porte `isPrivate: true`, les rôles sont restreints aux intervenants :
technicien, groupe attribué, responsable, auteur, adresse fixe. Ce que l'interface cache au
demandeur, la notification ne doit pas le lui révéler par un autre canal.

### Multilingue, par destinataire

Toutes les traductions d'un modèle sont chargées, puis la traduction est choisie **pour chaque
destinataire**, avec repli sur la langue par défaut. Choisir une langue une fois pour la fournée
enverrait le même texte au demandeur français et au technicien anglophone.

### Variables

`{{ ticket.id }}`, `{{ ticket.name }}`, `{{ ticket.status }}`, `{{ ticket.url }}`, `{{ evenement }}`,
plus **tous les champs simples de l'événement** — `{{ levelName }}`, `{{ agreementName }}`,
`{{ url }}` d'une enquête. Les énumérer à la main obligerait à revenir dans le code à chaque nouvel
événement, et un modèle ne pourrait jamais citer ce que l'événement est seul à savoir.

La substitution ne connaît ni condition ni boucle. Un modèle qui contient de la logique devient
illisible pour la personne qui l'écrit, et ce n'est presque jamais un développeur.

### Préférences

Une préférence porte sur **un** événement. La lire sans filtrer sur l'événement couperait toutes les
notifications d'un utilisateur dès qu'il en désactive une seule — le genre de défaut qui ne se voit
pas et se paie en confiance.

### File

L'état vit en base, pas seulement dans Redis : on doit pouvoir répondre à « ce message est-il parti,
et sinon pourquoi » des semaines plus tard. Le rejeu remet le compteur de tentatives à zéro — c'est
une décision humaine prise après correction, pas la suite des essais automatiques. La purge ne
touche que les envois réussis : un échec conservé est une question sans réponse qu'on voudra
reposer.

## 2. Courriel entrant

### Rattacher, ou ouvrir

Deux fils, dans cet ordre :

1. **`In-Reply-To` et `References`**, comparés aux `message_id` des envois. Exact, et insensible à
   la réécriture du sujet.
2. **Le marqueur `[#123]`** ajouté au sujet à l'envoi. Un numéro nu ne suffirait pas : « erreur
   #500 » dans un objet greffe une demande neuve sur un ticket sans rapport.

Le ticket cité doit être **ouvert et dans l'entité de la boîte**. Un courriel adressé au support du
siège ne complète pas le ticket d'une filiale au motif que le sujet en citait le numéro. Un ticket
clos ne reçoit pas de suivi : la réponse ouvre alors un ticket neuf, plutôt que de greffer une
demande sur un dossier fermé — ce qui la rendrait invisible de la file de travail.

### Refus et boucles

Dans l'ordre : un message que nous avons nous-mêmes émis, une réponse automatique, puis un
expéditeur inconnu.

La boucle est le vrai risque, pas le ticket de trop : un accusé de réception qui crée un ticket, qui
envoie une notification, qui déclenche un nouvel accusé. La comparaison porte sur l'**adresse nue** :
une messagerie écrit `Tick& <support@exemple.fr>`, et comparer la chaîne entière laisserait passer
exactement les messages contre lesquels le garde-fou existe.

Un expéditeur inconnu est refusé par défaut. `createUnknownRequester` ouvre la création de comptes à
quiconque sait écrire un courriel : c'est une décision d'administration, pas un réglage par défaut.

### Sous quel profil

Un courriel crée un ticket **au nom de son expéditeur**, mais il faut un profil pour que les droits,
les règles et les engagements s'appliquent comme pour une saisie. Le collecteur déclare donc le sien.
Écrire directement en propriétaire aurait été plus court et aurait privé les tickets nés d'un
courriel de leurs règles et de leurs échéances.

### Journal

`mail_collector_logs` garde ce que le collecteur a fait de chaque message : action, expéditeur,
sujet, motif de refus. Sans lui, « pourquoi ce courriel n'a-t-il pas créé de ticket » reste sans
réponse — le message a été marqué lu, et l'information a disparu avec lui. Un message en échec est
journalisé **et** marqué lu : le laisser non lu le ferait retenter à chaque cycle, indéfiniment.

### Adresses sortantes

`entity_settings.mail_from` et `mail_reply_to`, héritées de l'ancêtre le plus proche qui en déclare.
L'adresse de réponse est celle que le collecteur relève : c'est ce qui ferme la boucle.

### Éprouver le collecteur

Le compose fournit **deux** serveurs de messagerie, à dessein. Mailpit reçoit ce que l'outil envoie
et le montre ; il n'expose pas d'IMAP. GreenMail apporte SMTP **et** IMAP dans un seul conteneur,
avec création de boîte à la volée : c'est la boîte d'arrivée que le collecteur relève.

```bash
docker compose -f docker/compose.yaml up -d greenmail
```

Déposer un message dans la boîte relevée, depuis `apps/api` :

```bash
node -e "require('nodemailer').createTransport({host:'localhost',port:3025}).sendMail({from:'demandeur@exemple.fr',to:'support@exemple.fr',subject:'Test',text:'Bonjour'})"
```

Puis « Relever » depuis l'écran **Courriel entrant**, ou attendre le cycle de deux minutes.

## 3. Enquêtes de satisfaction

### Programmée, pas envoyée

À la clôture, un tirage décide — **une seule fois**, et le résultat est enregistré. Le rejouer à
chaque balayage ferait qu'un ticket finirait toujours par être tiré, et le taux ne voudrait plus
rien dire.

L'enquête est ensuite _programmée_ : le délai laisse au demandeur le temps de constater que le
problème ne revient pas. Une enquête reçue dans la seconde qui suit la clôture mesure surtout la
vitesse du serveur de messagerie.

### Le jeton

Le lien public porte un jeton aléatoire. C'est lui, et lui seul, qui autorise la réponse : l'enquête
doit pouvoir être remplie sans compte, depuis un client de messagerie, par quelqu'un qui ne se
connectera jamais à l'interface.

Deux conséquences assumées :

- le formulaire n'expose que le numéro et le sujet du ticket — tout ce qu'il montre devient public
  de fait ;
- une seule réponse est acceptée. Autoriser la modification transformerait un jeton qui circule en
  clair dans un courriel en droit permanent de réécrire une statistique.

### Relance

Une seule, après le délai configuré, et seulement si l'enquête est restée sans réponse et n'a pas
expiré. Le marqueur `reminder_sent_at` est ce qui empêche la relance de partir à chaque balayage.

## 4. Ce qui reste au jalon suivant

- OAuth2 pour le collecteur IMAP : la connexion par mot de passe suffit à un serveur interne, pas à
  Microsoft 365 ni à Google Workspace.
- Corps HTML des modèles : le champ existe et est envoyé, l'éditeur ne propose que le texte.
- Enquête externe par URL, c'est-à-dire déléguée à un outil tiers.
