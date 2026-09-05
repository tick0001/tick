import { pathToFileURL } from 'node:url';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { eq, plugins as pluginsTable, sql } from '@tick/db';
import type {
  EventHandler,
  EventName,
  HookHandler,
  HookName,
  HookOptions,
  PluginApi,
  PluginContext,
  PluginDefinition,
  PluginSearchField,
} from '@tick/plugin-sdk';
import { SearchRegistry } from '../search/search-registry.service.js';
import { DatabaseService } from '../database/database.service.js';
import { EventBus } from './event-bus.service.js';
import { emitEvent } from './event-buffer.js';
import { HookBus } from './hook-bus.service.js';
import { PluginMigrator } from './plugin-migrator.service.js';
import { PluginRegistry, type DiscoveredPlugin } from './plugin-registry.service.js';

/** Au-delà, le plugin est désactivé automatiquement. */
const FAILURE_THRESHOLD = 3;

export type PluginState = 'decouvert' | 'installe' | 'actif' | 'inactif' | 'erreur';

export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  state: PluginState;
  sdkRange: string;
  compatible: boolean;
  hasClient: boolean;
  lastError: string | null;
}

@Injectable()
export class PluginsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PluginsService.name);
  private readonly discovered = new Map<string, DiscoveredPlugin>();
  private readonly loaded = new Map<string, PluginDefinition>();

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: PluginRegistry,
    private readonly migrator: PluginMigrator,
    private readonly hooks: HookBus,
    private readonly events: EventBus,
    private readonly search: SearchRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.hooks.setFailureListener((pluginId, error, count) => {
      if (count < FAILURE_THRESHOLD) return;

      void this.disable(pluginId, error);
    });

    await this.synchronize();
  }

  /**
   * Aligne l'état connu sur ce qui est présent sur le disque, puis réactive les
   * plugins qui l'étaient.
   *
   * Un plugin disparu du disque n'est pas supprimé de la base : ses données
   * restent, et il redeviendra actif si le dossier revient. Effacer
   * automatiquement rendrait une erreur de déploiement destructrice.
   */
  async synchronize(): Promise<void> {
    const trouves = await this.registry.discover();

    this.discovered.clear();
    for (const plugin of trouves) this.discovered.set(plugin.manifest.id, plugin);

    let ordonnes: DiscoveredPlugin[];

    try {
      ordonnes = this.registry.resolveOrder(trouves);
    } catch (error) {
      this.logger.error(`Resolution des dependances impossible : ${String(error)}`);

      return;
    }

    for (const plugin of ordonnes) {
      await this.upsertRow(plugin);

      const etat = await this.stateOf(plugin.manifest.id);

      if (etat === 'actif') {
        // La ligne dit « actif » mais rien n'est enregistre dans ce processus :
        // c'est un redemarrage. On recharge, en montant de version si besoin.
        await this.upgradeIfNeeded(plugin);
        await this.activate(plugin.manifest.id).catch((error: unknown) => {
          this.logger.error(`Activation de ${plugin.manifest.id} impossible : ${String(error)}`);
        });
      }
    }
  }

  async list(): Promise<PluginStatus[]> {
    const lignes = await this.db.asOwner((tx) => tx.select().from(pluginsTable));

    return lignes.map((ligne) => {
      const decouvert = this.discovered.get(ligne.id);

      return {
        id: ligne.id,
        name: ligne.name,
        version: ligne.version,
        state: ligne.state,
        sdkRange: ligne.sdkRange,
        compatible: decouvert ? this.registry.isCompatible(decouvert.manifest) : false,
        hasClient: Boolean(decouvert?.manifest.client),
        lastError: ligne.lastError,
      };
    });
  }

  /** Installe : schéma dédié, migrations, puis crochet `install` du plugin. */
  async install(id: string): Promise<void> {
    const plugin = this.require(id);

    if (!this.registry.isCompatible(plugin.manifest)) {
      throw new BadRequestException(
        `Le plugin « ${id} » demande un SDK ${plugin.manifest.sdk}, incompatible avec cette instance.`,
      );
    }

    await this.migrator.createSchema(plugin);
    await this.migrator.migrate(plugin);

    const definition = await this.load(plugin);
    await definition.install?.(this.createContext(plugin));

    await this.setState(id, 'installe', {
      installedAt: new Date(),
      version: plugin.manifest.version,
    });
    this.logger.log(`Plugin « ${id} » installé.`);
  }

  /** Active : charge le module et lui laisse enregistrer ce qu'il veut. */
  async activate(id: string): Promise<void> {
    const plugin = this.require(id);
    const definition = await this.load(plugin);
    const context = this.createContext(plugin);

    // Retrait avant enregistrement : une reactivation ne doit pas empiler deux
    // fois les mêmes hooks.
    this.hooks.unregisterPlugin(id);
    this.events.unregisterPlugin(id);
    this.search.unregisterPlugin(id);

    await definition.register(this.createApi(plugin, context));

    await this.setState(id, 'actif', { activatedAt: new Date(), lastError: null, failureCount: 0 });
    emitEvent('plugin.activated', { pluginId: id });
    this.logger.log(`Plugin « ${id} » actif.`);
  }

  /** Désactive : retire les enregistrements, conserve les données. */
  async deactivate(id: string): Promise<void> {
    this.hooks.unregisterPlugin(id);
    this.events.unregisterPlugin(id);
    this.search.unregisterPlugin(id);
    this.loaded.delete(id);

    await this.setState(id, 'inactif', {});
    this.logger.log(`Plugin « ${id} » desactive.`);
  }

  /**
   * Désinstalle : crochet `uninstall`, puis suppression du schéma.
   *
   * `DROP SCHEMA CASCADE` garantit qu'il ne reste rien — c'est tout l'intérêt
   * d'avoir donné à chaque plugin son propre schéma.
   */
  async uninstall(id: string): Promise<void> {
    const plugin = this.discovered.get(id);

    if (plugin) {
      const definition = await this.load(plugin).catch(() => null);

      await definition?.uninstall?.(this.createContext(plugin));
    }

    this.hooks.unregisterPlugin(id);
    this.events.unregisterPlugin(id);
    this.loaded.delete(id);

    if (plugin) await this.migrator.dropSchema(plugin);
    await this.migrator.forget(id);
    await this.db.asOwner((tx) => tx.delete(pluginsTable).where(eq(pluginsTable.id, id)));

    this.logger.log(`Plugin « ${id} » desinstalle.`);
  }

  /** Bascule un plugin en erreur après des échecs répétés. */
  async disable(id: string, error: unknown): Promise<void> {
    this.hooks.unregisterPlugin(id);
    this.events.unregisterPlugin(id);
    this.loaded.delete(id);

    await this.setState(id, 'erreur', { lastError: String(error) });
    this.logger.error(`Plugin « ${id} » desactive apres echecs repetes : ${String(error)}`);
  }

  private async upgradeIfNeeded(plugin: DiscoveredPlugin): Promise<void> {
    const [ligne] = await this.db.asOwner((tx) =>
      tx.select().from(pluginsTable).where(eq(pluginsTable.id, plugin.manifest.id)),
    );

    if (!ligne || ligne.version === plugin.manifest.version) return;

    await this.migrator.migrate(plugin);

    const definition = await this.load(plugin);
    await definition.upgrade?.(this.createContext(plugin), ligne.version);

    await this.setState(plugin.manifest.id, ligne.state, { version: plugin.manifest.version });
    this.logger.log(
      `Plugin « ${plugin.manifest.id} » : ${ligne.version} → ${plugin.manifest.version}.`,
    );
  }

  private require(id: string): DiscoveredPlugin {
    const plugin = this.discovered.get(id);

    if (!plugin) throw new NotFoundException(`Plugin « ${id} » introuvable sur le disque.`);

    return plugin;
  }

  /** Charge le module serveur du plugin, une seule fois par processus. */
  private async load(plugin: DiscoveredPlugin): Promise<PluginDefinition> {
    const deja = this.loaded.get(plugin.manifest.id);
    if (deja) return deja;

    if (!plugin.manifest.server) {
      // Un plugin purement interface est legitime : il n'a rien a charger ici.
      const vide: PluginDefinition = { register: () => undefined };

      this.loaded.set(plugin.manifest.id, vide);

      return vide;
    }

    const fichier = this.registry.resolveInside(plugin.directory, plugin.manifest.server);
    const module = (await import(pathToFileURL(fichier).href)) as { default?: PluginDefinition };
    const definition = module.default;

    if (!definition || typeof definition.register !== 'function') {
      throw new BadRequestException(
        `Le plugin « ${plugin.manifest.id} » n'exporte pas de définition valide par défaut.`,
      );
    }

    this.loaded.set(plugin.manifest.id, definition);

    return definition;
  }

  private createContext(plugin: DiscoveredPlugin): PluginContext {
    const prefixe = `plugin:${plugin.manifest.id}`;
    const logger = new Logger(prefixe);

    return {
      id: plugin.manifest.id,
      version: plugin.manifest.version,
      schema: plugin.schema,
      logger: {
        debug: (message) => {
          logger.debug(message);
        },
        log: (message) => {
          logger.log(message);
        },
        warn: (message) => {
          logger.warn(message);
        },
        error: (message) => {
          logger.error(message);
        },
      },
      db: {
        query: async <T = Record<string, unknown>>(texte: string, params: unknown[] = []) =>
          this.db.asPlugin(plugin.schema, async (tx) => {
            const resultat = await tx.execute<T & Record<string, unknown>>(
              sql.raw(this.bindParams(texte, params)),
            );

            return resultat.rows as T[];
          }),
      },
    };
  }

  /**
   * Interpole les paramètres d'une requête de plugin.
   *
   * Drizzle n'expose pas de requête brute paramétrée sur `execute` : les valeurs
   * sont donc échappées ici, avec les règles de PostgreSQL. Ce point sera revu
   * au jalon J3, où la surface d'accès aux données sera définie pour de bon.
   */
  private bindParams(texte: string, params: readonly unknown[]): string {
    return texte.replace(/\$(\d+)/g, (_correspondance, index: string) => {
      const valeur = params[Number(index) - 1];

      if (valeur === null || valeur === undefined) return 'NULL';
      if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
      if (valeur instanceof Date) return `'${valeur.toISOString()}'`;

      // Refuser plutot que de convertir : un objet deviendrait
      // « [object Object] » dans la requete, ce qui echouerait plus tard sans
      // dire pourquoi. Le plugin doit serialiser lui-meme.
      if (typeof valeur !== 'string') {
        throw new Error(
          `Parametre de requete non pris en charge (${typeof valeur}) : ` +
            `seuls les types simples et les dates sont acceptes.`,
        );
      }

      return `'${valeur.replaceAll("'", "''")}'`;
    });
  }

  private createApi(plugin: DiscoveredPlugin, context: PluginContext): PluginApi {
    const permissions = new Set<string>(plugin.manifest.permissions);
    const exiger = (permission: string): void => {
      if (!permissions.has(permission)) {
        throw new Error(
          `Le plugin « ${plugin.manifest.id} » n'a pas déclaré la permission « ${permission} ».`,
        );
      }
    };

    return {
      context,
      hooks: {
        on: <K extends HookName>(name: K, handler: HookHandler<K>, options?: HookOptions) => {
          exiger('hooks');
          this.hooks.register(plugin.manifest.id, context, name, handler, options?.priority);
        },
      },
      events: {
        on: <K extends EventName>(name: K, handler: EventHandler<K>) => {
          exiger('events');
          this.events.register(plugin.manifest.id, context, name, handler);
        },
      },
      search: {
        registerField: (field: PluginSearchField) => {
          exiger('search');
          this.search.register({
            // Prefixe force : deux plugins ne peuvent pas se disputer une cle,
            // et l'origine d'un champ reste lisible dans l'interface.
            key: `plugin:${plugin.manifest.id}:${field.key}`,
            labelKey: field.label,
            type: field.type,
            operators: field.operators,
            column: sql.raw(field.sql),
            ...(field.options ? { options: field.options } : {}),
            pluginId: plugin.manifest.id,
          });
        },
      },
    };
  }

  private async upsertRow(plugin: DiscoveredPlugin): Promise<void> {
    await this.db.asOwner((tx) =>
      tx
        .insert(pluginsTable)
        .values({
          id: plugin.manifest.id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          sdkRange: plugin.manifest.sdk,
          manifest: plugin.manifest,
          state: 'decouvert',
        })
        .onConflictDoUpdate({
          target: pluginsTable.id,
          // L'etat n'est pas touche : il appartient au cycle de vie, pas au
          // manifeste trouve sur le disque.
          set: {
            name: plugin.manifest.name,
            sdkRange: plugin.manifest.sdk,
            manifest: plugin.manifest,
            updatedAt: new Date(),
          },
        }),
    );
  }

  private async stateOf(id: string): Promise<PluginState | undefined> {
    const [ligne] = await this.db.asOwner((tx) =>
      tx.select({ state: pluginsTable.state }).from(pluginsTable).where(eq(pluginsTable.id, id)),
    );

    return ligne?.state;
  }

  private async setState(
    id: string,
    state: PluginState,
    patch: Partial<typeof pluginsTable.$inferInsert>,
  ): Promise<void> {
    await this.db.asOwner((tx) =>
      tx
        .update(pluginsTable)
        .set({ state, updatedAt: new Date(), ...patch })
        .where(eq(pluginsTable.id, id)),
    );
  }
}
