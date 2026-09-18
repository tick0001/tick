# Système de plugins

Objectif : une vraie puissance d'extension, sans la dette qui l'accompagne d'ordinaire. Quand un
plugin accède à tout, toute refonte interne casse l'écosystème. Ici la surface publique est
**explicite, versionnée et restreinte** : `@tick/plugin-sdk`.

Un plugin s'exécute dans le processus de l'API (choix acté : pas de bac à sable). La confiance est
donc administrative — on installe ce qu'on a choisi d'installer — mais elle est encadrée par des
garde-fous réels décrits en section 6.

## 1. Anatomie

```
mon-plugin/
  tick.plugin.json      manifeste
  dist/server.js        point d'entrée serveur (ESM, facultatif)
  dist/client.js        point d'entrée interface (ESM, facultatif)
  migrations/           migrations SQL du schéma du plugin
```

La référence d'écriture, avec chaque signature, est le [SDK de plugins](15-sdk-plugins.md). Ce
document-ci dit pourquoi le substrat est fait ainsi, et ce qui reste à construire.

## 2. Manifeste

```json
{
  "id": "messagerie",
  "name": "Annonces en messagerie",
  "version": "1.0.0",
  "sdk": "^0.8.0",
  "license": "AGPL-3.0-or-later",
  "dependencies": {},
  "permissions": ["schema:own", "events", "http:outbound"],
  "settings": [
    { "key": "webhook", "label": "Adresse du webhook", "type": "secret", "scope": "entity" }
  ],
  "server": "./dist/server.js",
  "migrations": "./migrations"
}
```

`sdk` est la contrainte de compatibilité, exprimée en semver sur la version du SDK — pas sur celle
de l'application. Le cœur peut évoluer tant que le contrat tient.

`dependencies` nomme d'autres plugins et leur plage de versions. Les plugins sont chargés dans
l'ordre de leurs dépendances ; une dépendance absente, d'une version hors plage ou circulaire est
refusée avec un message qui la nomme.

`permissions` est déclaratif **et** vérifié à l'appel : un plugin qui n'a pas demandé
`http:outbound` voit son client HTTP refusé, un plugin sans `hooks` ne peut en poser aucun. Cela ne
remplace pas une isolation, mais rend les intentions lisibles avant installation — l'écran des
extensions les affiche — et transforme un débordement par le chemin prévu en refus nommé.
`routes`, `cron` et `notification:send` sont admises mais réservées : aucun point d'extension ne
leur correspond encore.

`settings` déclare des réglages que le cœur affiche, valide, stocke, chiffre et fait hériter
d'entité en entité. C'est ce qui permet à un plugin d'être configurable sans exposer de route ni
dessiner d'écran.

## 3. Point d'entrée serveur

```ts
import { definePlugin, PluginRefusal } from '@tick/plugin-sdk';

export default definePlugin({
  async install(ctx)         { /* migrations appliquées automatiquement avant */ },
  async upgrade(ctx, depuis) { /* migration de données spécifique */ },
  async uninstall(ctx)       { /* le schéma est supprimé automatiquement après */ },

  register(api) {
    // Hooks synchrones, dans la transaction — peuvent modifier ou refuser
    api.hooks.on('ticket.beforeCreate', async (ticket, ctx) => {
      if (…) throw new PluginRefusal('…');
      return { ...ticket };
    });

    // Événements asynchrones — après commit, réessayés en cas d'échec
    api.events.on('ticket.solved', async (evt, ctx) => {
      const webhook = await ctx.settings.get('webhook', { entityId: evt.entityId });
      await ctx.http.request(webhook, { method: 'POST', body: '…' });
    });

    // Recherche : rendre ses champs interrogeables
    //
    // La clé est préfixée par l'identifiant du plugin, et l'expression SQL
    // fournie est du code de l'extension — jamais une saisie d'utilisateur.
    // Les valeurs comparées, elles, passent en paramètres liés.
    api.search.registerField({ key: 'delai', label: '…', type: 'number', operators: ['gte'], sql: '…' });

    // Tableaux de bord : proposer un widget
    api.dashboards.registerWidget({ key: 'compteur', label: '…', description: '…' });
  },
});
```

L'accès aux données passe par le contexte, `ctx.db.query(…)`, avec le schéma du plugin en tête du
`search_path`.

**Pas encore exposé.** Les routes HTTP propres à un plugin, les tâches planifiées, les critères et
actions du moteur de règles, les événements de notification et les champs additionnels sur les
objets du cœur. Chacun attend un usage réel qui en dessine la forme : exposer une surface sans
utilisateur, c'est la figer avant de savoir ce qu'elle doit être.

## 4. Point d'entrée interface

```ts
import { definePluginClient } from '@tick/plugin-sdk/client';

export default definePluginClient({
  register(ui) {
    ui.slots.add('app.header', {
      id: 'mon-plugin.badge',
      render(element, contexte) {
        element.textContent = '…';
      },
    });
  },
});
```

Emplacements disponibles : `app.header`, `app.sidebar`, `entity.list.actions` et
`dashboard.widgets`. Les onglets de ticket, les colonnes de liste et les traductions fournies par
un plugin sont envisagés, pas construits.

**Aucune dépendance n'est partagée avec l'hôte.** Le bundle est un module ESM autonome, chargé par
un `import()` ordinaire — ni carte d'import, ni variable globale, ni instance de React commune.
C'est ce que permet le contrat `render(element, contexte)`, qui remplace le rendu de composants
React ; la décision et son coût sont exposés dans
[l'architecture](02-architecture.md#points-dextension-côté-interface).

## 5. Cycle de vie

1. **Découverte** — parcours de `PLUGINS_PATH`, lecture des manifestes.
2. **Validation** — schéma du manifeste, compatibilité `sdk`, résolution des dépendances par tri
   topologique, détection des cycles.
3. **Installation** — création du schéma PostgreSQL dédié, application des migrations, appel de
   `install()`.
4. **Activation** — appel de `register()`, enregistrement des hooks, abonnements, champs et
   widgets.
5. **Mise à jour** — migrations en attente puis `upgrade(ctx, versionPrécédente)`.
6. **Désactivation** — retrait des enregistrements, données et réglages conservés.
7. **Désinstallation** — `uninstall()` puis suppression du schéma et des réglages.

Les états possibles sont : _découvert_, _installé_, _actif_, _inactif_, _en erreur_. L'écran
**Réglages › Extensions** montre chacun, avec les permissions demandées et la dernière erreur, et
porte les actions du cycle de vie et les réglages.

## 6. Garde-fous

**Un schéma PostgreSQL par plugin.** Les tables d'un plugin vivent dans `plugin_messagerie`,
jamais dans `public`. Trois bénéfices : aucune collision de noms, désinstallation propre par
`DROP SCHEMA`, et lisibilité immédiate de ce qu'un plugin a créé.

**Aucune modification des tables du cœur.** Un plugin qui veut ajouter des données sur un objet du
cœur crée ses propres tables, avec une clé étrangère vers le cœur. Cela préserve entièrement la
liberté de faire évoluer le schéma central.

**Le `search_path` place le schéma du plugin en tête.** Une requête sans préfixe atteint d'abord
ses tables ; `public` suit, et le cœur y reste protégé par le Row-Level Security — la connexion
d'un plugin est celle de l'application, jamais celle du propriétaire. Hors requête HTTP — un
gestionnaire d'événement en arrière-plan — le périmètre d'entités est **vide** : le plugin voit
ses propres tables mais aucune donnée métier. Lui accorder le périmètre total serait plus commode
et annulerait l'isolation.

**Des réglages hors de portée.** La table des réglages est refusée au rôle applicatif : un plugin
ne lit pas, par SQL, les secrets d'un autre. Il ne lit les siens que par `settings.get`, qui les
déchiffre pour lui seul.

**Installer un plugin, c'est lui accorder les droits du processus de l'API.** Il lit
l'environnement — `DATABASE_URL`, qui ouvre la base en propriétaire, hors RLS, `ENCRYPTION_KEY`,
`SESSION_SECRET` —, le disque et le réseau. Les permissions du manifeste, le schéma dédié, le
RLS et le client HTTP encadrent ce que fait un plugin **par l'API qu'on lui donne** : ils
rendent l'erreur difficile et l'intention lisible, ils n'arrêtent pas un plugin écrit pour les
contourner. N'installer que ce dont on a lu le code, ou dont on fait confiance à l'auteur comme
on ferait confiance au code de l'application.

Et la licence ne change rien à cela. Un plugin qui n'utilise que l'interface publiée peut être
distribué sans son code source — voir [EXCEPTION-PLUGINS.md](../EXCEPTION-PLUGINS.md) —, ce qui
rend le conseil précédent plus exigeant, pas moins : le code qu'on ne peut pas lire s'exécute
avec les mêmes droits que celui qu'on peut lire.

**Une sortie réseau qui applique la politique de l'instance.** Le client HTTP du contexte refuse
les réseaux internes quand l'instance les refuse, épingle l'adresse vérifiée jusqu'à la connexion
et ne suit aucune redirection. Un plugin _pourrait_ appeler `fetch` directement — il s'exécute dans
le processus — et contournerait alors cette politique : c'est un motif de refus à la relecture,
pas une impossibilité technique.

**Isolation des défaillances.** Un hook est borné à deux secondes. Il distingue le refus délibéré
(`PluginRefusal`), rendu à l'utilisateur comme une erreur de saisie, de la panne, qui annule
l'opération en nommant le plugin. Trois pannes consécutives désactivent le plugin — l'API reste
debout. Une exception dans un gestionnaire d'événement est réessayée jusqu'à cinq tentatives, sans
impact métier, et sans rappeler les autres abonnés qui avaient réussi : une annonce déjà partie ne
part pas deux fois.

**Traçabilité.** Le journal de l'instance porte, préfixées par l'identifiant du plugin, ses
propres écritures de journal, ses pannes de hook, ses échecs d'événement et, au niveau `debug`,
chacun de ses appels sortants — méthode, hôte et statut, jamais l'adresse complète. Un journal
d'actions consultable depuis l'administration reste à construire ; en attendant, un plugin qui
agit à l'extérieur garde sa propre trace, comme `messagerie` avec sa table d'envois.

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

## 8. Plugins de référence

Deux plugins vivent dans le dépôt et servent de documentation exécutable.

- **`plugins/exemple-bonjour`** exerce le cycle de vie, les hooks (modification et refus), les
  événements, les migrations et deux emplacements d'interface.
- **`plugins/messagerie`** est un plugin d'usage réel : il annonce les créations, escalades et
  résolutions de tickets dans un canal Slack, Mattermost ou Teams. Il exerce les réglages par
  entité avec héritage, les secrets, la sortie HTTP, les reprises d'événements et un schéma propre.

Un point d'extension n'est pas considéré comme stable tant qu'aucun usage réel ne l'exerce : c'est
la condition du passage du SDK en `1.0`.
