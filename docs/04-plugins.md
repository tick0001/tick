# Système de plugins

Objectif : la puissance d'extension de GLPI, sans la dette qui l'accompagne. Chez GLPI un plugin
accède à tout, donc toute refonte interne casse l'écosystème. Ici la surface publique est
**explicite, versionnée et restreinte** : `@tick/plugin-sdk`.

Un plugin s'exécute dans le processus de l'API (choix acté : pas de bac à sable). La confiance est
donc administrative — on installe ce qu'on a choisi d'installer — mais elle est encadrée par des
garde-fous réels décrits en section 6.

## 1. Anatomie

```
mon-plugin/
  tick.plugin.json      manifeste
  dist/server.js        point d'entrée serveur (ESM)
  dist/client.js        point d'entrée interface (ESM, facultatif)
  migrations/           migrations SQL du schéma du plugin
  locales/              traductions
```

## 2. Manifeste

```json
{
  "id": "rapports-sla",
  "name": "Rapports SLA",
  "version": "1.2.0",
  "sdk": "^1.0.0",
  "author": "…",
  "license": "GPL-3.0-or-later",
  "homepage": "…",
  "dependencies": { "socle-reporting": "^2.0.0" },
  "permissions": ["ticket:read", "schema:own", "cron", "notification:send", "http:outbound"],
  "rights": [{ "key": "sla_report", "label": "Rapports SLA", "actions": ["read", "update"] }],
  "server": "./dist/server.js",
  "client": "./dist/client.js",
  "migrations": "./migrations"
}
```

`sdk` est la contrainte de compatibilité, exprimée en semver sur la version du SDK — pas sur celle
de l'application. Le cœur peut évoluer tant que le contrat tient.

`permissions` est déclaratif et vérifié à l'appel : un plugin qui n'a pas demandé `http:outbound`
voit son client HTTP refusé. Cela ne remplace pas une isolation, mais rend les intentions
auditables avant installation et journalise les débordements.

## 3. Point d'entrée serveur

```ts
import { definePlugin } from '@tick/plugin-sdk';

export default definePlugin({
  async install(ctx)            { /* migrations appliquées automatiquement avant */ },
  async upgrade(ctx, depuis)    { /* migration de données spécifique */ },
  async uninstall(ctx)          { /* le schéma est supprimé automatiquement après */ },

  register(api) {
    // Hooks synchrones — peuvent modifier ou refuser
    api.hooks.on('ticket.beforeCreate', async (ticket, ctx) => { … });

    // Événements asynchrones — après commit
    api.events.on('ticket.resolved', async (evt, ctx) => { … });

    // Moteur de règles : nouveaux critères et nouvelles actions
    api.rules.registerCriterion({ … });
    api.rules.registerAction({ … });

    // Notifications : nouvel événement et ses variables
    api.notifications.registerEvent({ … });

    // Champs additionnels sur un objet existant (stockés en jsonb, dans le schéma du plugin)
    api.fields.extend('ticket', { … });

    // Recherche : rendre ses champs interrogeables
    //
    // La cle est prefixee par l'identifiant du plugin, et l'expression SQL
    // fournie est du code de l'extension — jamais une saisie d'utilisateur.
    // Les valeurs comparees, elles, passent en parametres lies.
    api.search.registerField({ key: 'delai', label: '…', type: 'number', operators: ['gte'], sql: '…' });

    // Tâches planifiées
    api.cron.register('rapport-quotidien', '0 2 * * *', handler);

    // Routes HTTP, montées sous /api/plugins/rapports-sla
    api.routes.register(MonController);

    // Accès base, restreint au schéma du plugin
    const db = api.db.schema();
  },
});
```

## 4. Point d'entrée interface

```ts
import { definePluginClient } from '@tick/plugin-sdk/client';

export default definePluginClient({
  register(ui) {
    ui.slots.add('ticket.tabs',       { id: 'sla', label: '…', component: OngletSla });
    ui.slots.add('menu.assistance',   { … });
    ui.slots.add('ticket.list.columns', { … });
    ui.slots.add('dashboard.widgets', { … });
    ui.i18n.add(locales);
  },
});
```

**Aucune dépendance n'est partagée avec l'hôte.** Le bundle est un module ESM autonome, chargé par
un `import()` ordinaire — ni carte d'import, ni variable globale, ni instance de React commune.
C'est ce que permet le contrat `render(element, contexte)`, qui remplace le rendu de composants
React ; la décision et son coût sont exposés dans
[l'architecture](02-architecture.md#points-dextension-côté-interface).

## 5. Cycle de vie

1. **Découverte** — parcours de `plugins/`, lecture des manifestes.
2. **Validation** — schéma du manifeste, compatibilité `sdk`, résolution des dépendances par tri
   topologique, détection des cycles.
3. **Installation** — création du schéma PostgreSQL dédié, application des migrations, insertion
   des droits déclarés, appel de `install()`.
4. **Activation** — appel de `register()`, enregistrement des hooks, routes, crons et emplacements.
5. **Mise à jour** — migrations en attente puis `upgrade(ctx, versionPrécédente)`.
6. **Désactivation** — retrait des enregistrements, données conservées.
7. **Désinstallation** — `uninstall()` puis suppression du schéma et des droits.

Les états possibles sont : _découvert_, _installé_, _actif_, _inactif_, _en erreur_.

## 6. Garde-fous

**Un schéma PostgreSQL par plugin.** Les tables d'un plugin vivent dans `plugin_rapports_sla`,
jamais dans `public`. Trois bénéfices : aucune collision de noms, désinstallation propre par
`DROP SCHEMA`, et lisibilité immédiate de ce qu'un plugin a créé. Le `search_path` de sa connexion
est restreint à son schéma plus les vues de lecture du cœur.

**Aucune modification des tables du cœur.** Un plugin qui veut ajouter des données sur un objet du
cœur crée ses propres tables, avec une clé étrangère vers le cœur. Cela préserve entièrement la
liberté de faire évoluer le schéma central.

**Le `search_path` est restreint.** Les connexions ouvertes pour le compte d'un plugin placent son
schéma en premier : une requête sans préfixe atteint ses tables, jamais celles du cœur. Hors
requête HTTP — un gestionnaire d'événement en arrière-plan — le périmètre d'entités est **vide** :
le plugin voit ses propres tables mais aucune donnée métier. Lui accorder le périmètre total serait
plus commode et annulerait l'isolation.

**Isolation des défaillances.** Un hook est borné par un délai maximal ; une exception dans un
hook annule l'opération en cours en la nommant explicitement ; une exception dans un gestionnaire
d'événement est réessayée puis mise en échec sans impact métier. Un plugin qui échoue de façon
répétée est basculé en erreur et désactivé — l'API reste debout.

**Traçabilité.** Toute action de plugin ayant un effet (écriture, envoi, appel sortant) est
journalisée avec l'identifiant du plugin, exploitable depuis l'administration.

## 7. Compatibilité et versions

Le SDK suit le versionnement sémantique, indépendamment de la version de l'application.

**Phase `0.x`, jusqu'au jalon J9.** La mécanique d'extension est construite avant le métier, mais
la surface exposée est dérivée du domaine réel au fur et à mesure : elle peut donc rompre sans
cérémonie tant qu'elle n'est pas figée. Le passage en `1.0` n'intervient que lorsque chaque point
d'extension est exercé par un usage véritable.

Une fois en `1.0` :

- Correctif : aucun impact.
- Mineure : ajouts uniquement, les plugins existants continuent de fonctionner.
- Majeure : rupture assumée, annoncée, accompagnée d'un guide de migration, avec la version
  précédente maintenue en parallèle pendant une période annoncée.

Toute rupture du SDK est un événement documenté. C'est le contrat qui rend un écosystème viable.

## 8. Plugin de référence

`plugins/exemple-bonjour` exerce chaque point d'extension : un hook, un événement, un critère de
règle, un champ additionnel, une route, un cron, un onglet et un widget. Il sert de documentation
exécutable et de test d'intégration du moteur lui-même — s'il casse, le contrat a été rompu.
