# SDK de plugins — référence

Ce document est la référence d'écriture d'un plugin. Le
[Système de plugins](04-plugins.md) explique _pourquoi_ le substrat est fait
ainsi ; celui-ci dit _comment_ s'en servir, avec du code qui tourne.

Deux plugins servent d'exemples, et sont montés par les tests :

- [`plugins/exemple-bonjour`](../plugins/exemple-bonjour) exerce les hooks, les
  événements et deux emplacements d'interface ;
- [`plugins/messagerie`](../plugins/messagerie) est un plugin d'usage réel : il
  annonce les tickets dans un canal Slack, Teams ou Mattermost, et exerce les
  réglages, les secrets, les requêtes sortantes et les reprises d'événements.

## Licence — à lire avant d'écrire

Tick& est publié sous **AGPL-3.0-or-later**, sans exception de liaison. Un
plugin est chargé **dans le processus** de l'API et appelle son code : il est
très probablement une œuvre dérivée, donc soumis à la même licence.

Écrire un plugin propriétaire suppose une exception de liaison qui n'existe pas
aujourd'hui. Si c'est votre besoin, demandez-la avant d'investir.

## Installation

```bash
pnpm add @tick/plugin-sdk
```

Le SDK contient des types, deux fonctions d'ancrage et la classe
`PluginRefusal`. Son point d'entrée n'embarque aucune dépendance : il se
regroupe dans le bundle du plugin sans rien emporter d'autre.

## Anatomie

Un plugin est un dossier déposé dans `PLUGINS_PATH`, avec un manifeste et un ou
deux points d'entrée compilés :

```
mon-plugin/
  tick.plugin.json     manifeste
  dist/server.js       chargé par l'API, facultatif
  dist/client.js       chargé par l'interface, facultatif
  migrations/          SQL du schéma propre au plugin
```

### Manifeste

```json
{
  "id": "mon-plugin",
  "name": "Mon plugin",
  "version": "1.0.0",
  "sdk": "^0.8.0",
  "description": "Ce que le plugin fait, en une phrase.",
  "license": "AGPL-3.0-or-later",
  "permissions": ["schema:own", "hooks", "events", "search", "http:outbound"],
  "rights": [{ "key": "mon_journal", "label": "Journal du plugin", "actions": ["read"] }],
  "settings": [
    { "key": "jeton", "label": "Jeton d'accès", "type": "secret" },
    { "key": "seuil", "label": "Priorité minimale", "type": "number", "min": 1, "max": 5 }
  ],
  "server": "./dist/server.js",
  "client": "./dist/client.js",
  "migrations": "./migrations"
}
```

L'identifiant s'écrit en minuscules, chiffres et tirets. Il nomme aussi le
schéma PostgreSQL du plugin, sous la forme `plugin_mon_plugin`.

`sdk` est une plage semver vérifiée au chargement : un plugin qui demande une
version incompatible est refusé plutôt que chargé à moitié.

`permissions` annonce ce que le plugin fait avant qu'il le fasse : un manifeste
se lit sans lire le code, et l'écran des extensions le montre avant
l'installation. Ce n'est pas qu'une déclaration :

| Permission          | Effet                                                         |
| ------------------- | ------------------------------------------------------------- |
| `hooks`             | Exigée par `api.hooks.on`                                     |
| `events`            | Exigée par `api.events.on`                                    |
| `search`            | Exigée par `api.search.registerField`                         |
| `dashboards`        | Exigée par `api.dashboards.registerWidget`                    |
| `http:outbound`     | Exigée par `context.http.request`                             |
| `schema:own`        | Informative : tout plugin reçoit son schéma                   |
| `routes`, `cron`    | Réservées : aucun point d'extension ne leur correspond encore |
| `notification:send` | Réservée, au même titre                                       |

Un appel sans la permission correspondante lève une erreur qui la nomme. Les
permissions réservées restent admises pour qu'un manifeste qui les cite ne
devienne pas invalide le jour où elles serviront ; les déclarer n'ouvre rien.

Rien de cela n'est une isolation : le plugin s'exécute dans le processus de
l'API, avec ses droits. Rien ne l'empêche techniquement d'appeler `fetch`,
d'importer `node:fs`, ni de lire `process.env` — dont l'adresse de la base en
propriétaire, qui échappe au Row-Level Security. Les permissions rendent les
intentions auditables et le chemin honnête commode ; contourner ce chemin est un
motif de refus à la relecture.

`rights` déclare des droits `{ key, label, actions }` — voir [Droits](#droits) —, où les actions se
prennent parmi `read`, `create`, `update` et `delete`.

`settings` déclare les réglages que l'administrateur renseigne — voir
[Réglages](#réglages).

## Point d'entrée serveur

```ts
import { definePlugin } from '@tick/plugin-sdk';

export default definePlugin({
  // Une seule fois, après création du schéma et application des migrations.
  async install(context) {
    context.logger.log('Installation.');
  },

  // À chaque activation : c'est ici que tout s'enregistre.
  register(api) {
    api.hooks.on('ticket.beforeCreate', (charge) => {
      // …
    });
  },
});
```

`register` est rappelé à chaque activation, et tout ce qu'il enregistre est
retiré à la désactivation. Ne rien enregistrer ailleurs : un écouteur posé dans
`install` survivrait à la désactivation, et le plugin continuerait d'agir alors
que l'administration le croit éteint.

### Contexte

```ts
interface PluginContext {
  readonly id: string; // identifiant du plugin
  readonly version: string;
  readonly schema: string; // nom du schéma PostgreSQL qui lui appartient
  readonly logger: PluginLogger; // debug, log, warn, error
  readonly db: PluginDatabase;
  readonly settings: PluginSettings; // réglages déclarés, héritage résolu
  readonly http: PluginHttp; // requêtes sortantes, politique de l'instance appliquée
  readonly instance: PluginInstance; // webUrl : l'adresse de l'interface, pour les liens
}
```

Chaque gestionnaire le reçoit en second argument, et `api.context` le donne dans
`register`.

## Hooks — modifier avant que ça arrive

Un hook est **synchrone dans la transaction** et peut modifier la charge ou la
refuser. C'est le seul moyen d'agir _avant_ qu'un objet existe.

```ts
import { PluginRefusal } from '@tick/plugin-sdk';

api.hooks.on('ticket.beforeCreate', (charge) => {
  if (charge.name.trim().length < 5) {
    throw new PluginRefusal('Un sujet de moins de cinq caractères ne dit rien.');
  }

  return { ...charge, name: charge.name.trim() };
});
```

Renvoyer un objet remplace la charge ; ne rien renvoyer la laisse telle quelle ;
lever une exception **annule la transaction entière**. C'est voulu : un hook qui
refuse à moitié laisserait un ticket créé sans ce qui devait l'accompagner.

**Refus ou panne.** `PluginRefusal` est un refus délibéré : l'utilisateur reçoit
une erreur de saisie (`400`) qui porte votre message et nomme le plugin. Toute
autre exception est une panne : l'opération échoue en erreur interne (`500`),
et la panne est comptée. Refuser par `throw new Error(…)` ferait passer chaque
refus pour une panne, et le plugin serait désactivé au troisième.

| Hook                        | Moment                         |
| --------------------------- | ------------------------------ |
| `entity.beforeCreate`       | Avant l'insertion d'une entité |
| `entity.beforeUpdate`       | Avant modification             |
| `ticket.beforeCreate`       | Avant l'insertion d'un ticket  |
| `ticket.beforeUpdate`       | Avant modification             |
| `ticket.beforeStatusChange` | Avant une transition d'état    |
| `followup.beforeAdd`        | Avant l'ajout d'un suivi       |

`options.priority` règle l'ordre entre plugins ; le plus petit passe en premier,
et la valeur par défaut est `100`.

Un hook dispose de **deux secondes**. Au-delà, l'opération est annulée et le
dépassement compte comme une panne : une transaction tenue ouverte bloque une
connexion et des verrous pour toute l'instance.

Après **trois pannes consécutives**, le plugin est désactivé et passe en
erreur, avec le dernier message visible dans l'écran des extensions. Un hook
qui réussit remet le compte à zéro : une panne passagère de temps à autre
n'éteint pas un plugin qui fonctionne.

## Événements — réagir après coup

Un événement est **asynchrone**, hors transaction, distribué par une file. Un
échec n'annule rien : c'est ce qui permet à un plugin lent ou cassé de ne pas
empêcher la création d'un ticket.

```ts
api.events.on('ticket.solved', async (charge, context) => {
  await context.db.query('INSERT INTO resolutions (ticket_id) VALUES ($1)', [charge.id]);
});
```

Un événement n'est publié qu'**après** la validation de la transaction : aucun
abonné n'est appelé pour une écriture annulée.

**Reprises.** Lever une exception demande une nouvelle tentative : cinq au
total, espacées d'une seconde puis de plus en plus. Seul l'abonné en échec est
rappelé — les autres, notifications du cœur comprises, ne le sont pas une
seconde fois. Un gestionnaire doit donc lever quand réessayer a un sens (un
service indisponible), et se contenter de journaliser sinon (une adresse
refusée ne répondra pas mieux à la cinquième tentative).

Hors requête HTTP, le périmètre d'entités d'un gestionnaire est **vide** : il
voit ses propres tables, mais aucune donnée métier protégée par le RLS. La
charge porte ce qu'il faut savoir de l'objet ; lui accorder le périmètre total
serait plus commode et annulerait l'isolation.

Une trentaine d'événements couvrent le cycle de vie ITIL : `ticket.created`,
`ticket.statusChanged`, `ticket.escalated`, `solution.answered`,
`validation.answered`, `itil.linked`, `itil.promoted`,
`satisfaction.answered`, `recurrence.generated`… La liste fait foi dans
[`packages/plugin-sdk/src/index.ts`](../packages/plugin-sdk/src/index.ts), où
chaque charge est typée.

**Choisir entre les deux** : hook si l'on doit modifier ou refuser, événement
sinon. Un hook qui ne fait que journaliser ralentit chaque création de ticket
pour rien.

## Base de données

Un plugin reçoit **son propre schéma PostgreSQL**, nommé d'après son
identifiant. Ses migrations s'y appliquent, et sa désinstallation le supprime
entièrement — c'est ce qui rend le retrait propre, sans résidus dans les tables
du cœur.

```ts
const lignes = await context.db.query<{ n: number }>(
  'SELECT count(*)::int AS n FROM journal WHERE entity_id = $1',
  [entityId],
);
```

Le schéma du plugin est placé **en tête** du `search_path` : `journal` désigne
sa propre table, sans préfixe à écrire. `public` suit, si bien qu'un nom absent
du schéma du plugin — `tickets` — désigne la table du cœur. Préfixez-le
(`public.tickets`) pour que la requête dise ce qu'elle lit. Le cœur y reste
protégé par le Row-Level Security, qu'un plugin ne contourne pas en lisant ses
tables directement.

Les valeurs de `$1`, `$2`… partent en **paramètres liés** : elles ne sont
jamais recopiées dans le texte de la requête, quel que soit le réglage du
serveur. Elles acceptent les chaînes, nombres, booléens, dates, `null`, et les
tableaux de ces valeurs — `WHERE id = ANY($1)`. Un objet est refusé :
sérialisez-le vous-même. Un `$n` sans valeur correspondante lève une erreur.

Le nom du schéma est disponible sous `context.schema`, pour les migrations qui
en ont besoin.

## Réglages

Un plugin **déclare** ses réglages ; le cœur affiche le formulaire dans l'écran
des extensions, valide la saisie, stocke la valeur, la chiffre si c'est un
secret et en résout l'héritage. Aucune route à écrire, aucun écran à dessiner.

```json
"settings": [
  { "key": "webhook", "label": "Adresse du webhook", "type": "secret", "scope": "entity" },
  { "key": "format", "label": "Format", "type": "enum", "options": ["slack", "teams"], "default": "slack", "scope": "entity" },
  { "key": "actif", "label": "Annoncer les créations", "type": "boolean", "default": true },
  { "key": "seuil", "label": "Priorité minimale", "type": "number", "min": 1, "max": 5, "default": 1 },
  { "key": "signature", "label": "Signature", "type": "text", "description": "Ajoutée en fin de message." }
]
```

| Type      | Champ                    | Contraintes                         |
| --------- | ------------------------ | ----------------------------------- |
| `text`    | Texte libre              | `default` facultatif                |
| `secret`  | Masqué, jamais réaffiché | **pas** de `default`                |
| `boolean` | Case à cocher            | `default` facultatif                |
| `number`  | Nombre                   | `min`, `max`, `default` facultatifs |
| `enum`    | Liste                    | `options`, et `default` parmi elles |

La clé s'écrit en minuscules, chiffres et soulignés ; cinquante réglages au
plus. Une propriété inconnue — `defaut` pour `default` — invalide le manifeste
plutôt que d'être ignorée.

**Portée.** `instance` (par défaut) : une seule valeur pour l'installation.
`entity` : une valeur par entité, héritée de l'ancêtre le plus proche qui en
porte une. La racine fixe ainsi un défaut, qu'une filiale remplace pour elle et
sa descendance. Un administrateur ne règle que les entités de son périmètre.

```ts
const webhook = await context.settings.get('webhook', { entityId: charge.entityId });
const seuil = await context.settings.get('seuil');
```

`get` rend la valeur posée sur l'entité ou sur son plus proche ancêtre, puis la
valeur par défaut du manifeste, sinon `null`. Un réglage d'entité lu sans
`entityId` lève une erreur — une installation peut avoir plusieurs racines —,
de même qu'une clé non déclarée : une faute de frappe ne doit pas passer pour
un réglage vide. Un réglage d'instance ignore `entityId`.

**Secrets.** Chiffrés au repos (AES-256-GCM, clé `ENCRYPTION_KEY`), jamais renvoyés par
l'API — l'écran indique seulement qu'une valeur est posée. `get` les rend
déchiffrés : c'est au plugin de ne jamais les journaliser, ni les recopier dans
un message d'erreur. La table des réglages est hors de portée du rôle
applicatif : un plugin ne lit les secrets d'un autre ni par `get`, limité à
ses propres clés, ni par `context.db`.

La désinstallation supprime les réglages avec le schéma.

## Requêtes sortantes

```ts
const reponse = await context.http.request(webhook, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'Bonjour' }),
  timeoutMs: 5_000,
});

if (reponse.status >= 500) throw new Error('Réessayer plus tard.');
```

Exige la permission `http:outbound`. C'est **le** chemin sortant d'un plugin,
parce qu'il applique ce que l'instance a décidé :

- seuls `http:` et `https:` passent, sans identifiants dans l'adresse ;
- si `ALLOW_PRIVATE_OUTBOUND` est à `false`, toute adresse interne — boucle
  locale, réseau privé, métadonnées d'un hébergeur — est refusée, et l'adresse
  vérifiée est **épinglée** jusqu'à la connexion : un nom qui change de
  résolution entre-temps n'y change rien ;
- les redirections ne sont **pas** suivies : la réponse `3xx` est rendue
  telle quelle, avec son en-tête `location` ;
- délai de dix secondes par défaut, trente au plus ; corps de réponse tronqué
  au-delà d'un mégaoctet.

Un statut `4xx` ou `5xx` n'est pas une exception : c'est au plugin d'en
décider. L'absence de réponse, elle, en est une.

Au niveau `debug`, le journal de l'instance trace chaque appel par sa méthode,
son hôte et son statut — jamais l'adresse complète, qui porte souvent un jeton.
Les messages d'erreur du client suivent la même règle.

## Champs de recherche

```ts
api.search.registerField({
  key: 'criticite', // préfixé par l'identifiant du plugin
  label: 'Criticité',
  type: 'number',
  operators: ['eq', 'gte', 'lte'],
  sql: '(SELECT criticite FROM mon_plugin.journal j WHERE j.ticket_id = tickets.id)',
});
```

Le champ devient interrogeable depuis la recherche multi-critères et
exportable. `sql` est une expression **écrite par vous**, évaluée dans le
contexte d'une requête sur `tickets` ; le moteur n'y injecte jamais de saisie,
les valeurs comparées passant en paramètres liés. C'est ce qui empêche un
critère de nommer une colonne arbitraire.

Un champ énuméré déclare ses valeurs dans `options?: string[]`.

## Widgets de tableau de bord

```ts
api.dashboards.registerWidget({
  key: 'compteur', // préfixé par l'identifiant du plugin
  label: 'Incidents du mois',
  description: 'Le compte des incidents ouverts sur le périmètre courant.',
});
```

Le widget devient proposable à la composition des tableaux de bord. Le
préfixage évite que deux extensions se disputent un nom, et permet à un tableau
enregistré de survivre à la désactivation temporaire de celui qui le fournit.

Exige la permission `dashboards`.

Le rendu, lui, se fait côté interface : déclarer le widget le rend disponible,
l'emplacement `dashboard.widgets` le dessine.

## Point d'entrée interface

```ts
import { definePluginClient } from '@tick/plugin-sdk/client';

export default definePluginClient({
  register(api) {
    api.slots.add('app.header', {
      id: 'monplugin.badge',
      order: 50,
      render(element, contexte) {
        element.textContent = `Bonjour ${contexte.profile.name}`;

        // Facultatif : appelée au démontage, pour ce que le DOM ne libère pas
        // seul — minuteries, abonnements, écouteurs globaux.
        return () => undefined;
      },
    });
  },
});
```

Emplacements : `app.header`, `app.sidebar`, `entity.list.actions`,
`dashboard.widgets`.

Le rendu est en DOM natif, sans React. L'hôte n'impose ainsi aucune version de
bibliothèque à ses plugins, et un plugin ne peut pas casser l'arbre de rendu de
l'interface.

Les classes Tailwind fonctionnent : le dossier `plugins` est déclaré comme
source dans la feuille de styles de l'hôte.

## Droits

`rights` est validé au chargement, mais **pas encore exploité**. Un droit sert à
protéger une route, et un plugin n'en expose pas encore : rien ne pourrait
l'exiger. Les droits déclarés n'apparaissent donc pas dans l'écran des profils
— un droit réglable que rien ne vérifie serait un droit fantôme, accordé et sans
effet. Ils y entreront avec les routes de plugin, sous la forme
`plugin:<id>:<clé>`, que l'API accepte déjà à l'enregistrement d'un profil.

## Compatibilité

Le SDK suit le semver. En `0.x`, il peut rompre entre deux versions mineures ;
à partir de `1.0`, une rupture impose une version majeure. Le champ `sdk` du
manifeste est vérifié à l'installation et à chaque activation, redémarrages
compris : un plugin incompatible est refusé et passe en erreur — plus tôt et
plus clairement qu'un plantage à la première utilisation.

L'activation est **tout ou rien**. Si `register` lève une exception, ce qu'il
avait déjà enregistré est retiré, et le plugin passe en erreur avec la cause.

## Cycle de vie

| Étape           | Ce qui se passe                                                       |
| --------------- | --------------------------------------------------------------------- |
| Découverte      | Le manifeste est lu et validé                                         |
| Installation    | Le schéma est créé, les migrations appliquées, `install` appelé       |
| Activation      | `register` est appelé, tout s'enregistre                              |
| Désactivation   | Tout ce qui a été enregistré est retiré                               |
| Montée          | Les nouvelles migrations passent, `upgrade` reçoit l'ancienne version |
| Désinstallation | `uninstall`, puis le schéma est supprimé                              |
