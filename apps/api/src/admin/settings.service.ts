import { Injectable } from '@nestjs/common';
import {
  settingKeySchema,
  type EntitySettings,
  type SettingKey,
  type WriteSettings,
} from '@tick/contracts';
import { EntitiesService } from '../entities/entities.service.js';

/**
 * Réglages effectifs d'une entité, avec leur origine.
 *
 * L'origine est tout l'intérêt de l'écran : « 7 jours » ne dit pas si la valeur
 * a été posée ici ou héritée de la racine, et c'est pourtant ce qu'il faut
 * savoir avant de la changer — modifier une valeur héritée la détache du parent,
 * définitivement et sans le dire.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly entities: EntitiesService) {}

  async read(entityId: number): Promise<EntitySettings> {
    const entite = await this.entities.findById(entityId);
    const resolus = await this.entities.resolveSettings(entityId);

    return {
      entityId,
      entityName: entite.completeName,
      settings: settingKeySchema.options.map((cle: SettingKey) => ({
        key: cle,
        value: resolus.values[cle] ?? null,
        origin: resolus.origins[cle],
        isOwn: resolus.origins[cle]?.id === entityId,
      })),
    };
  }

  /**
   * Écrit la configuration propre à l'entité.
   *
   * `null` n'est pas « vide » mais « rétablir l'héritage » : c'est la seule
   * façon de revenir au comportement du parent après avoir posé une valeur
   * locale. Les clés absentes du corps ne sont pas touchées, ce qui permet à
   * l'écran de n'envoyer que ce qu'il a modifié.
   */
  async write(entityId: number, patch: WriteSettings): Promise<EntitySettings> {
    await this.entities.findById(entityId);

    const donnees = patch as Record<string, unknown>;
    const ecrit: Record<string, unknown> = {};

    for (const cle of settingKeySchema.options) {
      if (cle in donnees) ecrit[cle] = donnees[cle];
    }

    if (Object.keys(ecrit).length > 0) await this.entities.writeSettings(entityId, ecrit);

    return this.read(entityId);
  }
}
