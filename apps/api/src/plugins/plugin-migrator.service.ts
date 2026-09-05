import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, pluginMigrations, sql } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import type { DiscoveredPlugin } from './plugin-registry.service.js';

/**
 * Schéma SQL dédié par plugin, et migrations propres à chacun.
 *
 * Trois bénéfices que le partage du schéma `public` ne donnerait pas : aucune
 * collision de noms entre plugins, une désinstallation qui ne laisse rien
 * derrière elle (`DROP SCHEMA`), et la possibilité de voir d'un coup d'œil ce
 * qu'un plugin a créé.
 *
 * Un plugin ne modifie jamais les tables du cœur : il crée les siennes, avec
 * des clés étrangères vers le cœur si besoin. C'est ce qui préserve la liberté
 * de faire évoluer le schéma central.
 */
@Injectable()
export class PluginMigrator {
  private readonly logger = new Logger(PluginMigrator.name);

  constructor(private readonly db: DatabaseService) {}

  async createSchema(plugin: DiscoveredPlugin): Promise<void> {
    await this.db.asOwner(async (tx) => {
      // Identifiant validé par le manifeste (minuscules, chiffres, tirets) puis
      // transformé : il ne peut pas contenir de guillemet.
      await tx.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${plugin.schema}`));
      await tx.execute(sql.raw(`GRANT USAGE, CREATE ON SCHEMA ${plugin.schema} TO tick_app`));
      await tx.execute(
        sql.raw(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${plugin.schema} ` +
            `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tick_app`,
        ),
      );
      await tx.execute(
        sql.raw(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${plugin.schema} ` +
            `GRANT USAGE, SELECT ON SEQUENCES TO tick_app`,
        ),
      );
    });
  }

  async dropSchema(plugin: DiscoveredPlugin): Promise<void> {
    await this.db.asOwner(async (tx) => {
      await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS ${plugin.schema} CASCADE`));
    });
  }

  /**
   * Applique les migrations en attente, dans l'ordre des noms de fichiers.
   *
   * Une migration déjà appliquée dont le contenu a changé est refusée : deux
   * installations partiraient sinon d'un schéma différent en croyant être à la
   * même version, et l'écart ne se verrait qu'au premier bug inexplicable.
   */
  async migrate(plugin: DiscoveredPlugin): Promise<number> {
    const dossier = this.migrationsDirectory(plugin);
    const fichiers = await this.listMigrations(dossier);

    if (fichiers.length === 0) return 0;

    const appliquees = await this.db.asOwner((tx) =>
      tx.select().from(pluginMigrations).where(eq(pluginMigrations.pluginId, plugin.manifest.id)),
    );
    const empreintes = new Map(appliquees.map((ligne) => [ligne.filename, ligne.checksum]));

    let compte = 0;

    for (const fichier of fichiers) {
      const contenu = await readFile(join(dossier, fichier), 'utf8');
      const empreinte = createHash('sha256').update(contenu).digest('hex');
      const connue = empreintes.get(fichier);

      if (connue === empreinte) continue;

      if (connue) {
        throw new Error(
          `La migration ${fichier} du plugin « ${plugin.manifest.id} » a été modifiée ` +
            `après avoir été appliquée. Ajoutez une nouvelle migration plutôt que de ` +
            `changer celle-ci.`,
        );
      }

      await this.db.asOwner(async (tx) => {
        // Le `search_path` place le schéma du plugin en premier : une migration
        // qui écrit `CREATE TABLE rapports` crée sa propre table, pas une table
        // du cœur.
        await tx.execute(sql.raw(`SET LOCAL search_path TO ${plugin.schema}, public`));
        await tx.execute(sql.raw(contenu));
        await tx.insert(pluginMigrations).values({
          pluginId: plugin.manifest.id,
          filename: fichier,
          checksum: empreinte,
        });
      });

      compte += 1;
    }

    if (compte > 0) {
      this.logger.log(
        `${String(compte)} migration(s) appliquée(s) pour « ${plugin.manifest.id} ».`,
      );
    }

    return compte;
  }

  /** Oublie les migrations d'un plugin désinstallé. */
  async forget(pluginId: string): Promise<void> {
    await this.db.asOwner((tx) =>
      tx.delete(pluginMigrations).where(eq(pluginMigrations.pluginId, pluginId)),
    );
  }

  async isApplied(pluginId: string, filename: string): Promise<boolean> {
    const [ligne] = await this.db.asOwner((tx) =>
      tx
        .select()
        .from(pluginMigrations)
        .where(
          and(eq(pluginMigrations.pluginId, pluginId), eq(pluginMigrations.filename, filename)),
        ),
    );

    return ligne !== undefined;
  }

  private migrationsDirectory(plugin: DiscoveredPlugin): string {
    return join(plugin.directory, plugin.manifest.migrations);
  }

  private async listMigrations(dossier: string): Promise<string[]> {
    try {
      const fichiers = await readdir(dossier);

      return fichiers.filter((nom) => nom.endsWith('.sql')).sort();
    } catch {
      return [];
    }
  }
}
