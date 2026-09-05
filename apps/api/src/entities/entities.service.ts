import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateEntity, EntitySummary, UpdateEntity } from '@tick/contracts';
import { and, asc, eq, entities, entitySettings, isNull, sql } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';

/** Parametres d'entite pouvant etre herites. Une valeur nulle delegue au parent. */
const INHERITABLE_SETTINGS = [
  'autoCloseDelayDays',
  'autoPurgeDelayDays',
  'mailFrom',
  'mailReplyTo',
  'defaultLocale',
] as const;

export type InheritableSetting = (typeof INHERITABLE_SETTINGS)[number];

export interface ResolvedSettings {
  values: Record<InheritableSetting, unknown>;
  /** Entite d'ou provient chaque valeur effective, ou null si aucune n'existe. */
  origins: Record<InheritableSetting, { id: number; completeName: string } | null>;
}

function toSummary(row: typeof entities.$inferSelect): EntitySummary {
  return {
    id: row.id,
    name: row.name,
    completeName: row.completeName,
    path: row.path,
    level: row.level,
    parentId: row.parentId,
  };
}

@Injectable()
export class EntitiesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Entites visibles dans le perimetre de travail.
   *
   * Aucun filtre d'entite n'apparait dans cette requete : le Row-Level Security
   * s'en charge a partir du contexte pose sur la transaction. C'est le principe
   * du modele, et l'endroit ou la plupart des clones de GLPI se trompent.
   */
  async list(): Promise<EntitySummary[]> {
    const rows = await this.db.asUser((tx) =>
      tx.select().from(entities).where(isNull(entities.deletedAt)).orderBy(asc(entities.path)),
    );

    return rows.map(toSummary);
  }

  async findById(id: number): Promise<EntitySummary> {
    const [row] = await this.db.asUser((tx) =>
      tx
        .select()
        .from(entities)
        .where(and(eq(entities.id, id), isNull(entities.deletedAt))),
    );

    if (!row) throw new NotFoundException('Entite introuvable dans le perimetre courant.');

    return toSummary(row);
  }

  async create(input: CreateEntity): Promise<EntitySummary> {
    const [row] = await this.db.asUser((tx) =>
      tx
        .insert(entities)
        .values({
          parentId: input.parentId,
          name: input.name,
          comment: input.comment ?? null,
          // Recalcules par le declencheur a partir du parent : les valeurs
          // fournies ici sont des marques de position obligatoires.
          path: 'temporaire',
          completeName: input.name,
        })
        .returning(),
    );

    if (!row) throw new BadRequestException('Creation impossible dans ce perimetre.');

    return toSummary(row);
  }

  /**
   * Met a jour une entite, deplacement de sous-arbre compris.
   *
   * Changer `parentId` reecrit le chemin de tous les descendants par cascade de
   * declencheurs, et met a jour les objets qui y sont rattaches.
   */
  async update(id: number, input: UpdateEntity): Promise<EntitySummary> {
    const [row] = await this.db.asUser((tx) =>
      tx
        .update(entities)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.comment !== undefined ? { comment: input.comment ?? null } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        })
        .where(and(eq(entities.id, id), isNull(entities.deletedAt)))
        .returning(),
    );

    if (!row) throw new NotFoundException('Entite introuvable dans le perimetre courant.');

    return toSummary(row);
  }

  /** Suppression logique : l'entite quitte les listes sans perdre son historique. */
  async softDelete(id: number): Promise<void> {
    const context = requireContext();

    if (context.entityId === id) {
      throw new BadRequestException("Impossible de supprimer l'entite active.");
    }

    const [row] = await this.db.asUser((tx) =>
      tx
        .update(entities)
        .set({ deletedAt: new Date() })
        .where(and(eq(entities.id, id), isNull(entities.deletedAt)))
        .returning({ id: entities.id }),
    );

    if (!row) throw new NotFoundException('Entite introuvable dans le perimetre courant.');
  }

  /**
   * Resout la configuration effective d'une entite.
   *
   * Remonte l'arbre depuis l'entite jusqu'a la racine et retient, pour chaque
   * parametre, la premiere valeur explicite rencontree. L'origine est renvoyee
   * avec la valeur : sans elle, diagnostiquer une configuration heritee en
   * production devient une devinette.
   */
  async resolveSettings(entityId: number): Promise<ResolvedSettings> {
    const rows = await this.db.asUser(async (tx) => {
      const result = await tx.execute<
        Record<string, unknown> & { entityId: number; completeName: string; depth: number }
      >(sql`
        SELECT
          ancetre.id            AS "entityId",
          ancetre.complete_name AS "completeName",
          nlevel(ancetre.path)  AS "depth",
          s.auto_close_delay_days AS "autoCloseDelayDays",
          s.auto_purge_delay_days AS "autoPurgeDelayDays",
          s.mail_from             AS "mailFrom",
          s.mail_reply_to         AS "mailReplyTo",
          s.default_locale        AS "defaultLocale"
        FROM entities cible
        JOIN entities ancetre ON ancetre.path @> cible.path
        LEFT JOIN entity_settings s ON s.entity_id = ancetre.id
        WHERE cible.id = ${entityId}
        ORDER BY nlevel(ancetre.path) DESC
      `);

      return result.rows;
    });

    if (rows.length === 0) {
      throw new NotFoundException('Entite introuvable dans le perimetre courant.');
    }

    const values = {} as Record<InheritableSetting, unknown>;
    const origins = {} as ResolvedSettings['origins'];

    for (const key of INHERITABLE_SETTINGS) {
      const source = rows.find((row) => row[key] !== null && row[key] !== undefined);

      values[key] = source ? source[key] : null;
      origins[key] = source ? { id: source.entityId, completeName: source.completeName } : null;
    }

    return { values, origins };
  }

  /** Ecrit la configuration propre a une entite. Un champ nul retablit l'heritage. */
  async writeSettings(entityId: number, patch: Record<string, unknown>): Promise<void> {
    await this.db.asUser((tx) =>
      tx
        .insert(entitySettings)
        .values({ entityId, ...patch })
        .onConflictDoUpdate({
          target: entitySettings.entityId,
          set: { ...patch, updatedAt: new Date() },
        }),
    );
  }
}
