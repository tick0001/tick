import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, sql, type Connection } from '@tick/db';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';
import { EventBus } from '../plugins/event-bus.service.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { PluginMigrator } from '../plugins/plugin-migrator.service.js';
import { PluginRegistry } from '../plugins/plugin-registry.service.js';
import { PluginSettingsService } from '../plugins/plugin-settings.service.js';
import { PluginsService } from '../plugins/plugins.service.js';
import { SearchRegistry } from '../search/search-registry.service.js';
import { WidgetRegistry } from '../stats/widget-registry.service.js';

/**
 * Les plugins publiés avec chaque version, tels que l'exploitant les dépose.
 *
 * Le dossier produit par `scripts/empaqueter-plugins.mjs` est placé **hors du
 * dépôt**, là où aucun `node_modules` ne rattraperait un import oublié dans le
 * bundle. Chaque plugin doit s'y découvrir, s'installer, s'activer et se
 * retirer : c'est ce que fera une installation qui décompresse l'archive dans
 * son dossier des plugins.
 *
 * Les plugins sont renommés : la base de développement peut porter une
 * installation réelle de `messagerie`, que ce test ne doit ni réutiliser ni
 * désinstaller. Le code chargé, lui, est exactement celui de l'archive.
 */

interface Empaquete {
  id: string;
  version: string;
  dossier: string;
}

const PREFIXE = 'essai-publie-';

describe('Plugins publiés', () => {
  let racine: string;
  let empaquetes: Empaquete[] = [];
  let owner: Connection;
  let appDb: Connection;
  let db: DatabaseService;
  let plugins: PluginsService;
  let events: EventBus;

  const idDeTest = (id: string) => PREFIXE + id;
  const schemaDeTest = (id: string) => 'plugin_' + idDeTest(id).replaceAll('-', '_');

  beforeAll(async () => {
    racine = await mkdtemp(join(tmpdir(), 'tick-plugins-publies-'));

    // Chemin calculé plutôt qu'écrit : le script est du JavaScript sans
    // déclaration de types, et c'est son comportement qu'on éprouve.
    const script = pathToFileURL(resolve(__dirname, '../../../../scripts/empaqueter-plugins.mjs'));
    const { empaqueter } = (await import(script.href)) as {
      empaqueter: (destination: string) => Empaquete[];
    };

    empaquetes = empaqueter(racine);

    for (const plugin of empaquetes) {
      const chemin = join(plugin.dossier, 'tick.plugin.json');
      const manifeste = JSON.parse(await readFile(chemin, 'utf8')) as Record<string, unknown>;

      await writeFile(chemin, JSON.stringify({ ...manifeste, id: idDeTest(plugin.id) }));
    }

    process.env.PLUGINS_PATH = racine;
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

    owner = createDatabase({ connectionString: process.env.DATABASE_URL as string, max: 2 });
    appDb = createDatabase({ connectionString: process.env.DATABASE_APP_URL as string, max: 4 });
    db = new DatabaseService(appDb.db, owner.db, { owner, app: appDb });

    const hooks = new HookBus();

    // Le bus n'est pas démarré : sans file, les abonnements s'enregistrent
    // sans qu'aucun événement ne parte.
    events = new EventBus();

    plugins = new PluginsService(
      db,
      new PluginRegistry(),
      new PluginMigrator(db),
      hooks,
      events,
      new SearchRegistry(),
      new WidgetRegistry(),
      new PluginSettingsService(db, new SecretsService()),
    );

    await plugins.onApplicationBootstrap();
  }, 60_000);

  afterAll(async () => {
    for (const plugin of empaquetes) {
      await plugins.uninstall(idDeTest(plugin.id)).catch(() => undefined);
    }

    await Promise.all([owner.close(), appDb.close()]);
    await rm(racine, { recursive: true, force: true });
  });

  it('publie au moins le plugin messagerie', () => {
    expect(empaquetes.map((plugin) => plugin.id)).toContain('messagerie');
  });

  it('ne dépose que ce qu’une installation charge', async () => {
    for (const plugin of empaquetes) {
      const contenu = (await readdir(plugin.dossier, { recursive: true }))
        .map((chemin) => chemin.replaceAll('\\', '/'))
        .sort();

      // Ni sources, ni configuration de construction ou de test, ni
      // dépendances : seulement ce que le dossier des plugins doit contenir.
      for (const chemin of contenu) {
        expect(chemin).toMatch(
          /^(tick\.plugin\.json|README\.md|LICENSE|dist(\/.+\.(js|js\.map))?|migrations(\/.+\.sql)?)$/,
        );
      }
      expect(contenu).toContain('tick.plugin.json');
      expect(contenu).toContain('LICENSE');
    }
  });

  it('se découvre, compatible avec cette instance', async () => {
    const liste = await plugins.list();

    for (const plugin of empaquetes) {
      const ligne = liste.find((l) => l.id === idDeTest(plugin.id));

      expect(ligne?.state).toBe('decouvert');
      expect(ligne?.compatible).toBe(true);
    }
  });

  it('s’installe et s’active depuis le seul dossier déposé', async () => {
    const avant = events.count();

    for (const plugin of empaquetes) {
      await plugins.install(idDeTest(plugin.id));
      await plugins.activate(idDeTest(plugin.id));
    }

    const liste = await plugins.list();

    for (const plugin of empaquetes) {
      expect(liste.find((l) => l.id === idDeTest(plugin.id))?.state).toBe('actif');
    }

    // messagerie s'abonne à trois événements.
    expect(events.count() - avant).toBeGreaterThanOrEqual(3);
  });

  it('crée les tables de ses migrations', async () => {
    const tables = await db.asOwner((tx) =>
      tx.execute<{ nom: string } & Record<string, unknown>>(
        sql`SELECT table_name AS nom FROM information_schema.tables
             WHERE table_schema = ${schemaDeTest('messagerie')}`,
      ),
    );

    expect(tables.rows.map((ligne) => ligne.nom)).toContain('envois');
  });

  it('se retire sans laisser de schéma', async () => {
    for (const plugin of empaquetes) {
      await plugins.uninstall(idDeTest(plugin.id));
    }

    const schemas = await db.asOwner((tx) =>
      tx.execute<{ nom: string } & Record<string, unknown>>(
        sql`SELECT schema_name AS nom FROM information_schema.schemata
             WHERE schema_name LIKE ${'plugin_essai_publie_%'}`,
      ),
    );

    expect(schemas.rows).toHaveLength(0);
  });
});
