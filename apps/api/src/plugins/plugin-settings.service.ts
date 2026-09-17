import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PluginSettingView, PluginSettingValue } from '@tick/contracts';
import { and, eq, isNull, pluginSettings, sql } from '@tick/db';
import type { PluginManifest, PluginSetting } from '@tick/plugin-sdk/manifest';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';

/** Au-dela, un « texte » de reglage n'en est plus un. */
const TEXTE_MAXIMAL = 2000;

/**
 * Reglages declares par les plugins.
 *
 * Le plugin declare, l'administrateur renseigne, le coeur valide, stocke et
 * resout. Tout passe par le role proprietaire : le role applicatif n'a aucun
 * acces a la table, pour qu'un plugin ne puisse ni lire les reglages des autres
 * ni reecrire les siens sans validation.
 *
 * **Heritage.** Un reglage d'entite prend la valeur posee sur l'entite, sinon
 * sur son plus proche ancetre, sinon celle du manifeste. C'est ce qui permet a
 * la racine de fixer un defaut et a une filiale de le remplacer pour elle et sa
 * descendance.
 */
@Injectable()
export class PluginSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly secrets: SecretsService,
  ) {}

  /**
   * Valeur effective, pour le plugin lui-meme. Un secret est rendu dechiffre.
   *
   * Un reglage d'entite exige `entityId` : sans lui, « la racine » serait
   * ambigue — une installation peut en avoir plusieurs.
   */
  async valeur(
    manifeste: PluginManifest,
    cle: string,
    entityId?: number,
  ): Promise<PluginSettingValue | null> {
    const declaration = this.declaration(manifeste, cle);

    if (declaration.scope === 'entity' && entityId === undefined) {
      throw new Error(
        `Le reglage « ${cle} » du plugin « ${manifeste.id} » est un reglage d'entite : ` +
          'precisez entityId.',
      );
    }

    const stockee =
      declaration.scope === 'instance'
        ? await this.valeurInstance(manifeste.id, cle)
        : (await this.valeurHeritee(manifeste.id, cle, entityId as number))?.valeur;

    if (stockee === undefined) return this.defaut(declaration);

    return this.lire(declaration, stockee);
  }

  /**
   * Ce que l'ecran affiche pour un niveau : l'instance si `entityId` est nul,
   * sinon cette entite. Les secrets n'y sont jamais.
   */
  async vue(manifeste: PluginManifest, entityId: number | null): Promise<PluginSettingView[]> {
    const portee = entityId === null ? 'instance' : 'entity';
    const declarations = manifeste.settings.filter((reglage) => reglage.scope === portee);
    const vues: PluginSettingView[] = [];

    for (const declaration of declarations) {
      const ici = await this.valeurA(manifeste.id, declaration.key, entityId);
      const secret = declaration.type === 'secret';

      let heritee: PluginSettingView['inherited'] = null;

      if (entityId !== null && ici === undefined) {
        const trouvee = await this.valeurHeritee(manifeste.id, declaration.key, entityId);

        if (trouvee) {
          heritee = {
            fromEntityId: trouvee.entityId,
            fromEntityName: trouvee.entityName,
            value: secret ? null : this.lire(declaration, trouvee.valeur),
          };
        }
      }

      vues.push({
        key: declaration.key,
        label: declaration.label,
        description: declaration.description ?? null,
        type: declaration.type,
        scope: declaration.scope,
        options: declaration.type === 'enum' ? declaration.options : null,
        min: declaration.type === 'number' ? (declaration.min ?? null) : null,
        max: declaration.type === 'number' ? (declaration.max ?? null) : null,
        default: this.defaut(declaration),
        value: ici === undefined || secret ? null : this.lire(declaration, ici),
        isSet: ici !== undefined,
        inherited: heritee,
      });
    }

    return vues;
  }

  /**
   * Enregistre ce que l'administrateur a saisi.
   *
   * Tout est valide avant la moindre ecriture : une saisie dont une valeur est
   * fausse n'enregistre rien, plutot que la moitie.
   */
  async enregistrer(
    manifeste: PluginManifest,
    entityId: number | null,
    valeurs: Record<string, PluginSettingValue | null>,
  ): Promise<void> {
    const portee = entityId === null ? 'instance' : 'entity';
    const ecritures: { cle: string; valeur: string | null }[] = [];

    for (const [cle, valeur] of Object.entries(valeurs)) {
      const declaration = this.declaration(manifeste, cle);

      if (declaration.scope !== portee) {
        throw new BadRequestException(
          declaration.scope === 'entity'
            ? `Le reglage « ${cle} » se pose sur une entite.`
            : `Le reglage « ${cle} » vaut pour toute l'instance, pas pour une entite.`,
        );
      }

      ecritures.push({ cle, valeur: valeur === null ? null : this.ecrire(declaration, valeur) });
    }

    await this.db.asOwner(async (tx) => {
      for (const { cle, valeur } of ecritures) {
        const cible = and(
          eq(pluginSettings.pluginId, manifeste.id),
          eq(pluginSettings.key, cle),
          entityId === null
            ? isNull(pluginSettings.entityId)
            : eq(pluginSettings.entityId, entityId),
        );

        if (valeur === null) {
          await tx.delete(pluginSettings).where(cible);
          continue;
        }

        await tx
          .insert(pluginSettings)
          .values({ pluginId: manifeste.id, entityId, key: cle, value: valeur })
          .onConflictDoUpdate({
            target: [pluginSettings.pluginId, pluginSettings.entityId, pluginSettings.key],
            set: { value: valeur, updatedAt: new Date() },
          });
      }
    });
  }

  private declaration(manifeste: PluginManifest, cle: string): PluginSetting {
    const declaration = manifeste.settings.find((reglage) => reglage.key === cle);

    if (!declaration) {
      throw new NotFoundException(
        `Le plugin « ${manifeste.id} » ne declare aucun reglage « ${cle} ».`,
      );
    }

    return declaration;
  }

  private defaut(declaration: PluginSetting): PluginSettingValue | null {
    return declaration.type === 'secret' ? null : (declaration.default ?? null);
  }

  /** Valeur stockee a exactement ce niveau, sans heritage. */
  private async valeurA(
    pluginId: string,
    cle: string,
    entityId: number | null,
  ): Promise<string | undefined> {
    const [ligne] = await this.db.asOwner((tx) =>
      tx
        .select({ value: pluginSettings.value })
        .from(pluginSettings)
        .where(
          and(
            eq(pluginSettings.pluginId, pluginId),
            eq(pluginSettings.key, cle),
            entityId === null
              ? isNull(pluginSettings.entityId)
              : eq(pluginSettings.entityId, entityId),
          ),
        ),
    );

    return ligne?.value;
  }

  private async valeurInstance(pluginId: string, cle: string): Promise<string | undefined> {
    return this.valeurA(pluginId, cle, null);
  }

  /** La valeur de l'entite, ou de son plus proche ancetre qui en porte une. */
  private async valeurHeritee(
    pluginId: string,
    cle: string,
    entityId: number,
  ): Promise<{ valeur: string; entityId: number; entityName: string } | undefined> {
    const resultat = await this.db.asOwner((tx) =>
      tx.execute<{ value: string; entity_id: string; name: string }>(sql`
        SELECT s.value, s.entity_id, e.name
          FROM plugin_settings s
          JOIN entities e ON e.id = s.entity_id
         WHERE s.plugin_id = ${pluginId}
           AND s.key = ${cle}
           AND e.path @> (SELECT cible.path FROM entities cible WHERE cible.id = ${entityId})
         ORDER BY nlevel(e.path) DESC
         LIMIT 1
      `),
    );
    const ligne = resultat.rows[0];

    return ligne
      ? { valeur: ligne.value, entityId: Number(ligne.entity_id), entityName: ligne.name }
      : undefined;
  }

  private lire(declaration: PluginSetting, stockee: string): PluginSettingValue {
    switch (declaration.type) {
      case 'secret':
        return this.secrets.decrypt(stockee);
      case 'boolean':
        return stockee === 'true';
      case 'number':
        return Number(stockee);
      default:
        return stockee;
    }
  }

  private ecrire(declaration: PluginSetting, valeur: PluginSettingValue): string {
    const refus = (attendu: string): never => {
      throw new BadRequestException(`Le reglage « ${declaration.key} » attend ${attendu}.`);
    };

    switch (declaration.type) {
      case 'boolean':
        if (typeof valeur !== 'boolean') refus('un booleen');

        return String(valeur);

      case 'number': {
        if (typeof valeur !== 'number' || !Number.isFinite(valeur)) refus('un nombre');

        const nombre = valeur as number;

        if (declaration.min !== undefined && nombre < declaration.min) {
          refus(`un nombre d'au moins ${String(declaration.min)}`);
        }
        if (declaration.max !== undefined && nombre > declaration.max) {
          refus(`un nombre d'au plus ${String(declaration.max)}`);
        }

        return String(nombre);
      }

      case 'enum':
        if (typeof valeur !== 'string' || !declaration.options.includes(valeur)) {
          refus(`une valeur parmi : ${declaration.options.join(', ')}`);
        }

        return valeur as string;

      case 'secret':
        // Une chaine vide ne vide pas un secret : un champ laisse blanc ne doit
        // pas effacer ce qui etait enregistre. Effacer, c'est envoyer `null`.
        if (typeof valeur !== 'string' || valeur.length === 0) refus('un texte non vide');
        if ((valeur as string).length > TEXTE_MAXIMAL) refus('un texte plus court');

        return this.secrets.encrypt(valeur as string);

      default:
        if (typeof valeur !== 'string') refus('du texte');
        if ((valeur as string).length > TEXTE_MAXIMAL) refus('un texte plus court');

        return valeur as string;
    }
  }
}
