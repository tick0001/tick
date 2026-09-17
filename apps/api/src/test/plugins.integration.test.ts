import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, entities, eq, sql, type Connection } from '@tick/db';
import { runWithContext } from '../common/request-context.js';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { EventBus } from '../plugins/event-bus.service.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { PluginMigrator } from '../plugins/plugin-migrator.service.js';
import { PluginRegistry, SDK_VERSION } from '../plugins/plugin-registry.service.js';
import { PluginSettingsService } from '../plugins/plugin-settings.service.js';
import { PluginsService } from '../plugins/plugins.service.js';
import { SearchRegistry } from '../search/search-registry.service.js';
import { WidgetRegistry } from '../stats/widget-registry.service.js';

const PLUGIN_ID = 'essai-substrat';
const SCHEMA = 'plugin_essai_substrat';
/** Plugin qui echoue au milieu de son enregistrement. */
const BANCAL_ID = 'essai-bancal';

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
  /** Hors du perimetre de travail des tests : une racine a part. */
  let entiteAilleursId = 0;

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
          // Sans `http:outbound`, a dessein : la sortie doit etre refusee.
          permissions: ['schema:own', 'hooks', 'events'],
          settings: [
            { key: 'suffixe', label: 'Suffixe', type: 'text', default: '' },
            { key: 'etiquette', label: 'Etiquette', type: 'text', scope: 'entity' },
          ],
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
          api.hooks.on("entity.beforeCreate", async (payload, context) => {
            if (payload.name.includes("interdit")) {
              // Ce que fait PluginRefusal, sans le SDK : la marque suffit.
              const refus = new Error("nom refuse par le plugin");
              Object.defineProperty(refus, Symbol.for("tick.plugin.refusal"), { value: true });
              throw refus;
            }
            if (payload.name.includes("sortie")) {
              await context.http.request("http://127.0.0.1:9/");
            }
            let nom = payload.name.trim();
            if (nom.includes("reglage")) {
              nom += await context.settings.get("suffixe");
              const etiquette = await context.settings.get("etiquette", {
                entityId: payload.parentId,
              });
              if (etiquette) nom += " " + etiquette;
            }
            return { ...payload, name: nom };
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

    // Un hook pose, puis un widget sans la permission `dashboards` : l'echec
    // survient apres un premier enregistrement reussi.
    const bancal = join(racine, BANCAL_ID);
    await mkdir(join(bancal, 'migrations'), { recursive: true });
    await writeFile(
      join(bancal, 'tick.plugin.json'),
      JSON.stringify({
        id: BANCAL_ID,
        name: 'Essai bancal',
        version: '1.0.0',
        sdk: `^${SDK_VERSION}`,
        permissions: ['hooks'],
        server: './server.js',
      }),
    );
    await writeFile(
      join(bancal, 'server.js'),
      `export default {
        register(api) {
          api.hooks.on("ticket.beforeCreate", (payload) => payload);
          api.dashboards.registerWidget({ key: "k", label: "l", description: "d" });
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
      new WidgetRegistry(),
      new PluginSettingsService(db, new SecretsService()),
    );
    entites = new EntitiesService(db, hooks);

    // Le demarrage complet, et non la seule synchronisation : il branche la
    // desactivation automatique, dont depend le test des refus repetes.
    await plugins.onApplicationBootstrap();

    const [racineEntite] = await db.asOwner((tx) =>
      tx
        .insert(entities)
        .values({ name: 'PLUGIN Racine', parentId: null, path: 'temporaire', completeName: 'x' })
        .returning({ id: entities.id }),
    );
    entiteRacineId = (racineEntite as { id: number }).id;

    const [ailleurs] = await db.asOwner((tx) =>
      tx
        .insert(entities)
        .values({ name: 'PLUGIN Ailleurs', parentId: null, path: 'temporaire', completeName: 'x' })
        .returning({ id: entities.id }),
    );
    entiteAilleursId = (ailleurs as { id: number }).id;
  }, 60_000);

  afterAll(async () => {
    await plugins.uninstall(PLUGIN_ID).catch(() => undefined);
    await plugins.uninstall(BANCAL_ID).catch(() => undefined);
    await db.asOwner((tx) => tx.delete(entities).where(eq(entities.parentId, entiteRacineId)));
    await db.asOwner((tx) => tx.delete(entities).where(eq(entities.id, entiteRacineId)));
    await db.asOwner((tx) => tx.delete(entities).where(eq(entities.id, entiteAilleursId)));
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
        profileInterface: 'standard',
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
    // Ce que l'ecran montre avant d'installer : les intentions du plugin.
    expect(trouve?.permissions).toEqual(['schema:own', 'hooks', 'events']);
    expect(trouve?.hasSettings).toBe(true);

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
    const erreur = await dansLeContexte(() =>
      entites.create({ name: 'nom interdit', parentId: entiteRacineId }),
    ).catch((e: unknown) => e);

    // Une erreur de saisie qui nomme le plugin, pas une erreur interne.
    expect(erreur).toBeInstanceOf(BadRequestException);
    expect((erreur as Error).message).toMatch(/essai-substrat.*nom refuse/);

    // L'entite ne doit pas exister : un hook qui leve annule bien l'ecriture.
    const restantes = await db.asOwner((tx) =>
      tx.execute<{ total: number } & Record<string, unknown>>(
        sql`SELECT count(*) AS total FROM entities WHERE name = 'nom interdit'`,
      ),
    );
    expect(restantes.rows[0]?.total).toBe(0);
  });

  it('reste actif apres des refus repetes, qui ne sont pas des pannes', async () => {
    for (let essai = 0; essai < 4; essai += 1) {
      await expect(
        dansLeContexte(() => entites.create({ name: 'interdit', parentId: entiteRacineId })),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    // La desactivation retire les hooks avant toute ecriture : le compte suffit
    // a la voir, sans attendre qu'elle ait fini.
    expect(hooks.count('entity.beforeCreate')).toBe(1);
    expect((await plugins.list()).find((p) => p.id === PLUGIN_ID)?.state).toBe('actif');
  });

  it('n active rien d un plugin dont l enregistrement echoue en route', async () => {
    await plugins.install(BANCAL_ID);

    await expect(plugins.activate(BANCAL_ID)).rejects.toThrow(/dashboards/);

    // Le hook pose avant l'echec a ete retire, et l'ecran dit pourquoi.
    expect(hooks.count('ticket.beforeCreate')).toBe(0);
    const ligne = (await plugins.list()).find((p) => p.id === BANCAL_ID);
    expect(ligne?.state).toBe('erreur');
    expect(ligne?.lastError).toMatch(/dashboards/);
  });

  it('lit ses reglages, d instance et d entite, depuis un hook', async () => {
    await plugins.enregistrerReglages(PLUGIN_ID, null, { suffixe: ' [ok]' });
    await dansLeContexte(() =>
      plugins.enregistrerReglages(PLUGIN_ID, entiteRacineId, { etiquette: 'fil' }),
    );

    const creee = await dansLeContexte(() =>
      entites.create({ name: 'avec reglage', parentId: entiteRacineId }),
    );

    expect(creee.name).toBe('avec reglage [ok] fil');
  });

  it('refuse la sortie HTTP a un plugin qui ne l a pas declaree', async () => {
    await expect(
      dansLeContexte(() => entites.create({ name: 'sortie', parentId: entiteRacineId })),
    ).rejects.toThrow(/http:outbound/);
  });

  it('ne montre pas les reglages d une entite hors du perimetre', async () => {
    // Les reglages se lisent en proprietaire, hors Row-Level Security : sans
    // verification du perimetre, un administrateur de filiale lirait ceux de
    // n'importe quelle entite en devinant son identifiant.
    await expect(
      dansLeContexte(() => plugins.reglagesDe(PLUGIN_ID, entiteAilleursId)),
    ).rejects.toThrow(/introuvable/);
    await expect(
      dansLeContexte(() =>
        plugins.enregistrerReglages(PLUGIN_ID, entiteAilleursId, { etiquette: 'intrus' }),
      ),
    ).rejects.toThrow(/introuvable/);

    const dansLePerimetre = await dansLeContexte(() =>
      plugins.reglagesDe(PLUGIN_ID, entiteRacineId),
    );
    expect(dansLePerimetre.map((r) => [r.key, r.value])).toEqual([['etiquette', 'fil']]);
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

    const reglages = await db.asOwner((tx) =>
      tx.execute<{ total: number } & Record<string, unknown>>(
        sql`SELECT count(*)::int AS total FROM plugin_settings WHERE plugin_id = ${PLUGIN_ID}`,
      ),
    );
    expect(reglages.rows[0]?.total).toBe(0);

    const restant = (await plugins.list()).find((ligne) => ligne.id === PLUGIN_ID);
    expect(restant).toBeUndefined();
  });
});
