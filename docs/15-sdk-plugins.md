# SDK de plugins — référence

Ce document est la référence d'écriture d'un plugin. Le
[Système de plugins](04-plugins.md) explique _pourquoi_ le substrat est fait
ainsi ; celui-ci dit _comment_ s'en servir, avec du code qui tourne.

Le plugin de référence [`plugins/exemple-bonjour`](../plugins/exemple-bonjour)
exerce chaque point d'extension. Il est monté par les tests d'intégration : ce
qui y fonctionne est vérifié à chaque exécution de la suite.

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

Le SDK ne contient que des types et deux fonctions d'ancrage. Il n'embarque
aucune dépendance de production : rien de ce qu'il expose n'existe à l'exécution
en dehors de l'hôte.

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
  "sdk": "^0.7.0",
  "description": "Ce que le plugin fait, en une phrase.",
  "license": "AGPL-3.0-or-later",
  "permissions": ["schema:own", "hooks", "events", "search"],
  "rights": [{ "key": "mon_journal", "label": "Journal du plugin", "actions": ["read"] }],
  "server": "./dist/server.js",
  "client": "./dist/client.js",
  "migrations": "./migrations"
}
```

L'identifiant s'écrit en minuscules, chiffres et tirets. Il nomme aussi le
schéma PostgreSQL du plugin, sous la forme `plugin_mon_plugin`.

`sdk` est une plage semver vérifiée au chargement : un plugin qui demande une
version incompatible est refusé plutôt que chargé à moitié.

`permissions` est déclaratif et **appliqué**. Les valeurs admises sont
`schema:own`, `hooks`, `events`, `routes`, `cron`, `notification:send`,
`http:outbound` et `search`. Un plugin annonce ainsi ce qu'il fait avant de le
faire, ce qui rend un manifeste lisible sans lire le code.

`rights` déclare des droits `{ key, label, actions }`, où les actions se
prennent parmi `read`, `create`, `update` et `delete`.

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
}
```

## Hooks — modifier avant que ça arrive

Un hook est **synchrone dans la transaction** et peut modifier la charge ou la
refuser. C'est le seul moyen d'agir _avant_ qu'un objet existe.

```ts
api.hooks.on('ticket.beforeCreate', (charge) => {
  if (charge.name.trim().length < 5) {
    throw new Error('Un sujet de moins de cinq caractères ne dit rien.');
  }

  return { ...charge, name: charge.name.trim() };
});
```

Renvoyer un objet remplace la charge ; ne rien renvoyer la laisse telle quelle ;
lever refuse l'opération, et **annule la transaction entière**. C'est voulu :
un hook qui refuse à moitié laisserait un ticket créé sans ce qui devait
l'accompagner.

| Hook                        | Moment                         |
| --------------------------- | ------------------------------ |
| `entity.beforeCreate`       | Avant l'insertion d'une entité |
| `entity.beforeUpdate`       | Avant modification             |
| `ticket.beforeCreate`       | Avant l'insertion d'un ticket  |
| `ticket.beforeUpdate`       | Avant modification             |
| `ticket.beforeStatusChange` | Avant une transition d'état    |
| `followup.beforeAdd`        | Avant l'ajout d'un suivi       |

`options.order` règle l'ordre entre plugins ; le plus petit passe en premier.

## Événements — réagir après coup

Un événement est **asynchrone**, hors transaction, distribué par une file. Un
échec n'annule rien : c'est ce qui permet à un plugin lent ou cassé de ne pas
empêcher la création d'un ticket.

```ts
api.events.on('ticket.solved', async (charge) => {
  await context.db.query('INSERT INTO resolutions (ticket_id) VALUES ($1)', [charge.id]);
});
```

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

Le `search_path` de la connexion est restreint au schéma du plugin : `journal`
désigne ses propres tables, sans préfixe à écrire. Le cœur reste joignable en le
nommant explicitement — et y reste protégé par le Row-Level Security, qu'un
plugin ne contourne donc pas en lisant `public.tickets` directement.

Le nom du schéma est disponible sous `context.schema`, pour les migrations qui
en ont besoin.

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

Un plugin déclare ses droits dans le manifeste ; ils rejoignent le catalogue et
deviennent réglables dans l'écran des profils, avec les mêmes portées que ceux
du cœur.

Un droit déclaré mais que rien ne vérifie est un droit fantôme : configurable,
accordé, et sans effet. N'en déclarez que ce que vous exigez réellement.

## Compatibilité

Le SDK suit le semver. En `0.x`, il peut rompre entre deux versions mineures ;
à partir de `1.0`, une rupture impose une version majeure. Le champ `sdk` du
manifeste est vérifié au chargement, et un plugin incompatible est refusé — plus
tôt et plus clairement qu'un plantage à la première utilisation.

## Cycle de vie

| Étape           | Ce qui se passe                                                       |
| --------------- | --------------------------------------------------------------------- |
| Découverte      | Le manifeste est lu et validé                                         |
| Installation    | Le schéma est créé, les migrations appliquées, `install` appelé       |
| Activation      | `register` est appelé, tout s'enregistre                              |
| Désactivation   | Tout ce qui a été enregistré est retiré                               |
| Montée          | Les nouvelles migrations passent, `upgrade` reçoit l'ancienne version |
| Désinstallation | `uninstall`, puis le schéma est supprimé                              |
