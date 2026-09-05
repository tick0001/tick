import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, entities, eq, sql, type Connection } from '@tick/db';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { EventBus } from '../plugins/event-bus.service.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { PluginMigrator } from '../plugins/plugin-migrator.service.js';
import { PluginRegistry, SDK_VERSION } from '../plugins/plugin-registry.service.js';
import { PluginsService } from '../plugins/plugins.service.js';
import { SearchRegistry } from '../search/search-registry.service.js';

const PLUGIN_ID = 'essai-substrat';
const SCHEMA = 'plugin_essai_substrat';

/**
 * Cycle de vie complet du substrat d'extension — critere de sortie du jalon J2.
 *
 * Le plugin est fabrique par le test dans un dossier temporaire plutot que pris
 * dans le depot : le test ne depend d'aucun ordre de construction, et il decrit
 * exactement le contrat minimal qu'un plugin doit respecter.
 */
describe("Substrat d'extension", () => {
  let racine: string;
  let dossier: string;
  let owner: Connection;
  let appDb: Connection;
  let plugins: PluginsService;
  let hooks: HookBus;
  let entites: EntitiesService;
  let db: DatabaseService;
  let entiteRacineId = 0;

  const ecrirePlugin = async (version: string): Promise<void> => {
    await writeFile(
      join(dossier, 'tick.plugin.json'),
      JSON.stringify(
        {
          id: PLUGIN_ID,
          name: 'Essai du substrat',
          version,
          // Derive de la version reelle : le test suit les montees du SDK au lieu
          // d'echouer a chacune.
          sdk: `^${SDK_VERSION}`,
          permissions: ['schema:own', 'hooks', 'events'],
          server: './server.js',
          migrations: './migrations',
        },
        null,
        2,
      ),
    );
  };

  beforeAll(async () => {
    racine = await mkdtemp(join(tmpdir(), 'tick-plugins-'));
    dossier = join(racine, PLUGIN_ID);
    await mkdir(join(dossier, 'migrations'), { recursive: true });

    await ecrirePlugin('1.0.0');

    await writeFile(
      join(dossier, 'migrations', '0001_journal.sql'),
      'CREATE TABLE journal (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, ' +
        'evenement text NOT NULL, detail text);',
    );

    // Plugin minimal : un objet avec `register`. Le SDK n'est pas requis a
    // l'execution, `definePlugin` n'etant qu'une ancre de typage.
    await writeFile(
      join(dossier, 'server.js'),
      `export default {
        async install(context) {
          await context.db.query("INSERT INTO journal (evenement, detail) VALUES ($1, $2)", [
            "install",
            context.version,
          ]);
        },
        async upgrade(context, precedente) {
          await context.db.query("INSERT INTO journal (evenement, detail) VALUES ($1, $2)", [
            "upgrade",
            precedente + " vers " + context.version,
          ]);
        },
        register(api) {
          api.hooks.on("entity.beforeCreate", (payload) => {
            if (payload.name.includes("interdit")) {
              throw new Error("nom refuse par le plugin");
            }
            return { ...payload, name: payload.name.trim() };
          });
          api.events.on("entity.created", async (payload, context) => {
            await context.db.query("INSERT INTO journal (evenement, detail) VALUES ($1, $2)", [
              "entity.created",
              String(payload.id),
            ]);
          });
        },
      };`,
    );

    process.env.PLUGINS_PATH = racine;
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

    // Les services sont assembles a la main plutot que par le conteneur
    // d'injection : demarrer le module applicatif complet dans un worker de
    // test coutait plus de temps d'import et de memoire que le test lui-meme.
    owner = createDatabase({ connectionString: process.env.DATABASE_URL as string, max: 2 });
    appDb = createDatabase({ connectionString: process.env.DATABASE_APP_URL as string, max: 4 });
    db = new DatabaseService(appDb.db, owner.db, { owner, app: appDb });

    hooks = new HookBus();
    // Le bus d'evenements n'est pas demarre : sans file, les evenements sont
    // simplement abandonnes. Ce test porte sur le cycle de vie et sur les
    // hooks, qui eux sont synchrones.
    const events = new EventBus();
    const registry = new PluginRegistry();

    plugins = new PluginsService(
      db,
      registry,
      new PluginMigrator(db),
      hooks,
      events,
      new SearchRegistry(),
    );
    entites = new EntitiesService(db, hooks);

    await plugins.synchronize();

    const [racineEntite] = await db.asOwner((tx) =>
      tx
        .insert(entities)
        .values({ name: 'PLUGIN Racine', parentId: null, path: 'temporaire', completeName: 'x' })
        .returning({ id: entities.id }),
    );
    entiteRacineId = (racineEntite as { id: number }).id;
  }, 60_000);

  afterAll(async () => {
    await plugins.uninstall(PLUGIN_ID).catch(() => undefined);
    await db.asOwner((tx) => tx.delete(entities).where(eq(entities.parentId, entiteRacineId)));
    await db.asOwner((tx) => tx.delete(entities).where(eq(entities.id, entiteRacineId)));
    await Promise.all([owner.close(), appDb.close()]);
    await rm(racine, { recursive: true, force: true });
  });

  const chemin = async (id: number): Promise<string> => {
    const [ligne] = await db.asOwner((tx) =>
      tx.select({ path: entities.path }).from(entities).where(eq(entities.id, id)),
    );

    return (ligne as { path: string }).path;
  };

  const dansLeContexte = async <T>(work: () => Promise<T>): Promise<T> => {
    const path = await chemin(entiteRacineId);

    return runWithContext(
      {
        sessionId: 'test',
        userId: 1,
        profileId: 1,
        entityId: entiteRacineId,
        entityPath: path,
        includeSubEntities: true,
        locale: 'fr',
        scope: { subtreePaths: [path], exactPaths: [] },
      },
      work,
    );
  };

  const journal = async (): Promise<{ evenement: string; detail: string | null }[]> => {
    const resultat = await db.asOwner((tx) =>
      tx.execute<{ evenement: string; detail: string | null } & Record<string, unknown>>(
        sql.raw(`SELECT evenement, detail FROM ${SCHEMA}.journal ORDER BY id`),
      ),
    );

    return resultat.rows;
  };

  it('decouvre le plugin sans rien executer', async () => {
    const liste = await plugins.list();
    const trouve = liste.find((ligne) => ligne.id === PLUGIN_ID);

    expect(trouve?.state).toBe('decouvert');
    expect(trouve?.compatible).toBe(true);

    // Rien ne doit exister avant l'installation : decouvrir n'est pas installer.
    const schemas = await db.asOwner((tx) =>
      tx.execute<{ nom: string } & Record<string, unknown>>(
        sql`SELECT schema_name AS nom FROM information_schema.schemata WHERE schema_name = ${SCHEMA}`,
      ),
    );
    expect(schemas.rows).toHaveLength(0);
  });

  it('installe : schema dedie, migrations appliquees, crochet appele', async () => {
    await plugins.install(PLUGIN_ID);

    const lignes = await journal();

    expect(lignes).toEqual([{ evenement: 'install', detail: '1.0.0' }]);
  });

  it('active : les hooks sont enregistres', async () => {
    expect(hooks.count('entity.beforeCreate')).toBe(0);

    await plugins.activate(PLUGIN_ID);

    expect(hooks.count('entity.beforeCreate')).toBe(1);
  });

  it('intercepte un hook et transforme la donnee ecrite', async () => {
    const creee = await dansLeContexte(() =>
      entites.create({ name: '  Entite espacee  ', parentId: entiteRacineId }),
    );

    // Le nom a ete taille par le hook avant l'ecriture.
    expect(creee.name).toBe('Entite espacee');
  });

  it("annule l'operation quand le hook refuse", async () => {
    await expect(
      dansLeContexte(() => entites.create({ name: 'nom interdit', parentId: entiteRacineId })),
    ).rejects.toThrow(/essai-substrat/);

    // L'entite ne doit pas exister : un hook qui leve annule bien l'ecriture.
    const restantes = await db.asOwner((tx) =>
      tx.execute<{ total: number } & Record<string, unknown>>(
        sql`SELECT count(*) AS total FROM entities WHERE name = 'nom interdit'`,
      ),
    );
    expect(restantes.rows[0]?.total).toBe(0);
  });

  it('desactive : les hooks sont retires, les donnees conservees', async () => {
    await plugins.deactivate(PLUGIN_ID);

    expect(hooks.count('entity.beforeCreate')).toBe(0);
    expect(await journal()).not.toHaveLength(0);
  });

  it('monte de version : migrations et crochet upgrade', async () => {
    await plugins.activate(PLUGIN_ID);
    await ecrirePlugin('1.1.0');

    await writeFile(
      join(dossier, 'migrations', '0002_colonne.sql'),
      'ALTER TABLE journal ADD COLUMN origine text;',
    );

    await plugins.synchronize();

    const lignes = await journal();

    expect(lignes.some((ligne) => ligne.evenement === 'upgrade')).toBe(true);

    const colonnes = await db.asOwner((tx) =>
      tx.execute<{ nom: string } & Record<string, unknown>>(
        sql`SELECT column_name AS nom FROM information_schema.columns
            WHERE table_schema = ${SCHEMA} AND table_name = 'journal' AND column_name = 'origine'`,
      ),
    );
    expect(colonnes.rows).toHaveLength(1);
  });

  it('refuse une migration deja appliquee dont le contenu a change', async () => {
    await writeFile(
      join(dossier, 'migrations', '0002_colonne.sql'),
      'ALTER TABLE journal ADD COLUMN autre text;',
    );

    // Deux installations partiraient sinon d'un schema different en croyant
    // etre a la meme version.
    await expect(plugins.install(PLUGIN_ID)).rejects.toThrow(/modifiée/);

    await writeFile(
      join(dossier, 'migrations', '0002_colonne.sql'),
      'ALTER TABLE journal ADD COLUMN origine text;',
    );
  });

  it('desinstalle sans laisser de trace', async () => {
    await plugins.uninstall(PLUGIN_ID);

    const schemas = await db.asOwner((tx) =>
      tx.execute<{ nom: string } & Record<string, unknown>>(
        sql`SELECT schema_name AS nom FROM information_schema.schemata WHERE schema_name = ${SCHEMA}`,
      ),
    );
    expect(schemas.rows).toHaveLength(0);

    const migrations = await db.asOwner((tx) =>
      tx.execute<{ total: number } & Record<string, unknown>>(
        sql`SELECT count(*) AS total FROM plugin_migrations WHERE plugin_id = ${PLUGIN_ID}`,
      ),
    );
    expect(migrations.rows[0]?.total).toBe(0);

    const restant = (await plugins.list()).find((ligne) => ligne.id === PLUGIN_ID);
    expect(restant).toBeUndefined();
  });
});
