import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import {
  pluginManifestSchema,
  pluginSchemaName,
  type PluginManifest,
} from '@tick/plugin-sdk/manifest';
import { satisfies, validRange } from 'semver';
import { appRoot, loadEnv } from '../config/env.js';

/** Version du contrat exposé aux plugins. Doit suivre `@tick/plugin-sdk`. */
export const SDK_VERSION = '0.5.0';

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  /** Dossier du plugin, absolu. */
  directory: string;
  schema: string;
}

export class PluginResolutionError extends Error {}

/**
 * Découverte et validation des plugins présents sur le disque.
 *
 * Trois vérifications avant toute exécution de code tiers : le manifeste est
 * conforme, la version du SDK demandée est satisfaite, et les chemins déclarés
 * restent à l'intérieur du dossier du plugin.
 */
@Injectable()
export class PluginRegistry {
  private readonly logger = new Logger(PluginRegistry.name);
  private readonly connus = new Map<string, DiscoveredPlugin>();

  /** Plugin decouvert lors du dernier parcours, s'il existe. */
  find(id: string): DiscoveredPlugin | undefined {
    return this.connus.get(id);
  }

  /**
   * Racine où sont cherchés les plugins.
   *
   * Un chemin relatif part de la racine applicative, pas du répertoire de
   * travail : l'API se lance depuis `apps/api` en développement et depuis la
   * racine en production, et `./plugins` doit désigner le même dossier dans les
   * deux cas.
   */
  get root(): string {
    const configured = loadEnv().PLUGINS_PATH;

    return isAbsolute(configured) ? configured : resolve(appRoot(), configured);
  }

  /**
   * Résout un chemin déclaré dans un manifeste.
   *
   * Un manifeste est une donnée, pas du code de confiance : `../../etc/passwd`
   * y est aussi facile à écrire que `./dist/server.js`. Tout chemin sortant du
   * dossier du plugin est refusé.
   */
  resolveInside(directory: string, declared: string): string {
    const cible = resolve(directory, declared);
    const ecart = relative(directory, cible);

    if (ecart.startsWith('..') || isAbsolute(ecart)) {
      throw new PluginResolutionError(`Chemin hors du dossier du plugin : ${declared}`);
    }

    return cible;
  }

  /** Parcourt la racine et lit les manifestes valides. */
  async discover(): Promise<DiscoveredPlugin[]> {
    let entrees: string[];

    try {
      const contenu = await readdir(this.root, { withFileTypes: true });

      entrees = contenu.filter((entree) => entree.isDirectory()).map((entree) => entree.name);
    } catch {
      this.logger.debug(`Aucun dossier de plugins en ${this.root}`);

      return [];
    }

    const trouves: DiscoveredPlugin[] = [];

    for (const nom of entrees) {
      const directory = join(this.root, nom);
      const decouvert = await this.readManifest(directory);

      if (decouvert) trouves.push(decouvert);
    }

    this.connus.clear();
    for (const plugin of trouves) this.connus.set(plugin.manifest.id, plugin);

    return trouves;
  }

  private async readManifest(directory: string): Promise<DiscoveredPlugin | null> {
    let brut: string;

    try {
      brut = await readFile(join(directory, 'tick.plugin.json'), 'utf8');
    } catch {
      return null;
    }

    const resultat = pluginManifestSchema.safeParse(JSON.parse(brut));

    if (!resultat.success) {
      this.logger.warn(
        `Manifeste invalide dans ${directory} : ${resultat.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join(' ; ')}`,
      );

      return null;
    }

    const manifest = resultat.data;

    if (!validRange(manifest.sdk)) {
      this.logger.warn(`Plage de SDK illisible pour ${manifest.id} : ${manifest.sdk}`);

      return null;
    }

    return { manifest, directory, schema: pluginSchemaName(manifest.id) };
  }

  /** Le plugin est-il compatible avec le SDK de cette instance ? */
  isCompatible(manifest: PluginManifest): boolean {
    return satisfies(SDK_VERSION, manifest.sdk, { includePrerelease: true });
  }

  /**
   * Ordonne les plugins pour que chacun soit chargé après ses dépendances.
   *
   * Un cycle est refusé explicitement : le laisser passer produirait un ordre
   * arbitraire, donc un comportement qui change d'un démarrage à l'autre.
   */
  resolveOrder(plugins: readonly DiscoveredPlugin[]): DiscoveredPlugin[] {
    const parId = new Map(plugins.map((plugin) => [plugin.manifest.id, plugin]));
    const ordonnes: DiscoveredPlugin[] = [];
    const etat = new Map<string, 'en-cours' | 'fait'>();

    const visiter = (plugin: DiscoveredPlugin, chemin: string[]): void => {
      const courant = etat.get(plugin.manifest.id);

      if (courant === 'fait') return;

      if (courant === 'en-cours') {
        throw new PluginResolutionError(
          `Dépendance circulaire entre plugins : ${[...chemin, plugin.manifest.id].join(' → ')}`,
        );
      }

      etat.set(plugin.manifest.id, 'en-cours');

      for (const [id, plage] of Object.entries(plugin.manifest.dependencies)) {
        const dependance = parId.get(id);

        if (!dependance) {
          throw new PluginResolutionError(
            `Le plugin « ${plugin.manifest.id} » requiert « ${id} », absent.`,
          );
        }

        if (!satisfies(dependance.manifest.version, plage, { includePrerelease: true })) {
          throw new PluginResolutionError(
            `Le plugin « ${plugin.manifest.id} » requiert « ${id} » ${plage}, ` +
              `mais la version ${dependance.manifest.version} est installée.`,
          );
        }

        visiter(dependance, [...chemin, plugin.manifest.id]);
      }

      etat.set(plugin.manifest.id, 'fait');
      ordonnes.push(plugin);
    };

    for (const plugin of plugins) visiter(plugin, []);

    return ordonnes;
  }
}
