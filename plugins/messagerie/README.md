# Messagerie

Annonce les tickets dans un canal de discussion : un nouveau ticket, une
escalade, une résolution. Un canal par entité, hérité par sa descendance.

```
Nouvel incident #42 — Imprimante bloquée (priorité 4)
https://support.exemple.fr/tickets/42
```

| Messagerie      | Format  | Adresse à renseigner                                  |
| --------------- | ------- | ----------------------------------------------------- |
| Mattermost      | `slack` | Webhook entrant du canal                              |
| Slack           | `slack` | Webhook entrant de l'application                      |
| Rocket.Chat     | `slack` | Intégration entrante                                  |
| Discord         | `slack` | Webhook du salon, **suivi de `/slack`**               |
| Microsoft Teams | `teams` | Flux de travail « publier dans un canal » par webhook |

Les deux formats ont été vérifiés contre un serveur de capture, pas contre
chacune de ces messageries. Le format `teams` suit la documentation des
flux de travail Teams : un retour d'une installation réelle est bienvenu.

## Installer

Chaque version de Tick&, depuis la `0.1.11`, joint l'archive
`tick-plugins-<version>.tar.gz`, qui contient ce plugin prêt à déposer :

```bash
VERSION=0.1.11
curl -fLO https://github.com/tick0001/tick/releases/download/v$VERSION/tick-plugins-$VERSION.tar.gz
mkdir -p docker/plugins
tar xzf tick-plugins-$VERSION.tar.gz -C docker/plugins
```

`docker/plugins` est le dossier des plugins d'une installation par compose ;
sans conteneur, c'est celui de `PLUGINS_PATH`. Le
[guide d'exploitation](../../docs/14-installation.md#plugins-publiés) détaille
les deux cas. Redémarrer l'API, puis, dans **Réglages › Extensions** :

1. installer, puis activer ;
2. dans « S'applique à », choisir l'entité racine et coller l'adresse du
   webhook — la langue, elle, se règle sur « Toute l'instance » ;
3. créer un ticket.

## Réglages

| Réglage                  | Portée   | Défaut  |
| ------------------------ | -------- | ------- |
| Adresse du webhook       | entité   | aucune  |
| Format                   | entité   | `slack` |
| Annoncer les créations   | entité   | oui     |
| Priorité minimale        | entité   | 1       |
| Annoncer les escalades   | entité   | oui     |
| Annoncer les résolutions | entité   | non     |
| Langue des messages      | instance | `fr`    |

**Héritage.** Chaque réglage d'entité se lit sur l'entité du ticket, puis
sur ses ancêtres. Un webhook posé sur la racine sert à toute l'installation ;
une filiale qui a le sien l'utilise pour elle et sa descendance. Une entité
qui ne doit rien annoncer peut garder le canal hérité et désactiver les
annonces.

La priorité minimale ne filtre que les nouveaux tickets : une escalade ou une
résolution est annoncée quelle que soit la priorité.

## Ce qui se passe en cas d'échec

| Réponse de la messagerie     | Conduite                                   |
| ---------------------------- | ------------------------------------------ |
| `2xx`                        | Envoyé                                     |
| `429`, `5xx`, aucune réponse | Réessayé, jusqu'à cinq tentatives au total |
| Autre `4xx`                  | Journalisé, non réessayé                   |

Une adresse refusée ne répondra pas mieux à la cinquième tentative : elle
est signalée dans le journal de l'API, sans occuper la file. Une reprise ne
rappelle que ce plugin : les notifications du cœur ne partent pas deux fois.

Chaque tentative laisse une ligne dans la table `plugin_messagerie.envois` :
évènement, ticket, entité, code HTTP et début de la réponse. Les lignes de
plus de trente jours sont retirées au fil des envois.

```sql
SELECT envoye_le, evenement, ticket_id, statut, erreur
FROM plugin_messagerie.envois
ORDER BY envoye_le DESC
LIMIT 20;
```

## Sécurité

**L'adresse du webhook est un secret.** Elle porte le jeton qui permet
d'écrire dans le canal. Elle est chiffrée en base, jamais réaffichée, et
n'apparaît ni dans le journal de l'API ni dans la table des envois.

**Le titre d'un ticket est désamorcé.** Il est saisi par un demandeur, parfois
par un inconnu via un collecteur de courriel. Avant l'envoi, `<`, `>` et `&`
sont échappés, et un caractère invisible est inséré après chaque `@` et entre
`]` et `(`. `<!channel>`, `@here` ou un lien déguisé restent ainsi du texte,
sans alerter tout un canal. Contrepartie : Mattermost peut afficher `&lt;`
pour un titre qui contient `<`.

**Le réseau interne.** Si l'instance tourne avec
`ALLOW_PRIVATE_OUTBOUND=false`, un Mattermost hébergé sur le réseau local est
refusé comme toute adresse interne. Ce réglage d'exploitation l'emporte sur
celui du plugin.

**Rien d'autre n'est lu.** Le plugin n'écrit que ce que porte l'évènement :
numéro, titre, type et priorité du ticket, ou noms du niveau d'escalade et
de l'engagement. Il n'interroge pas les données de l'instance.

## Développer

Construire depuis le dépôt, puis produire le dossier à déposer :

```bash
pnpm --filter @tick/plugin-messagerie build
node scripts/empaqueter-plugins.mjs plugins-publies
```

Le SDK est inclus dans le bundle, et le plugin n'a aucune autre dépendance : le
dossier produit se charge sans `node_modules`. Le script refuse un bundle qui
en réclamerait un.

```bash
pnpm --filter @tick/plugin-messagerie test
pnpm --filter @tick/plugin-messagerie typecheck
```

`src/messages.ts` décide de ce qui s'écrit ; `src/server.ts`, de ce qui
part et de ce qui se réessaie. La référence du SDK est dans
[docs/15-sdk-plugins.md](../../docs/15-sdk-plugins.md).

## Licence

AGPL-3.0-or-later, comme Tick&.
