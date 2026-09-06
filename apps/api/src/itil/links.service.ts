import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateLink,
  ItilLink,
  ItilLinkType,
  ItilStatus,
  ItilType,
  Promote,
  PromotionResult,
  TicketActorInput,
} from '@tick/contracts';
import { sql, type SQL } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { HistoryService } from '../tickets/history.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import { toText } from '../tickets/ticket-sql.js';
import { ITIL_KINDS } from './itil-kinds.js';
import { ItilObjectsService } from './itil-objects.service.js';

interface LienRow {
  id: number;
  linkType: ItilLinkType;
  targetType: ItilType;
  targetId: number;
}

/**
 * Liens entre objets ITIL, et promotion.
 *
 * Un lien est un fait symétrique du point de vue de la lecture : depuis l'un ou
 * l'autre bout, il doit apparaître. Le sens n'est conservé que parce que
 * `duplicate` et `child` en ont un, et la lecture le retourne pour présenter
 * toujours « l'autre objet ».
 */
@Injectable()
export class LinksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly history: HistoryService,
    private readonly objects: ItilObjectsService,
    private readonly scopes: TicketScopeService,
  ) {}

  /**
   * Vérifie l'accès à un objet, quel que soit son type, et renvoie son entité.
   *
   * Passe par la même condition de portée que les listes : un lien ne doit pas
   * servir de porte dérobée vers un objet qu'on n'a pas le droit de lire.
   */
  private async requireObject(
    type: ItilType,
    id: number,
    action: 'read' | 'update',
  ): Promise<{ entityId: number; name: string; status: ItilStatus }> {
    const descripteur = ITIL_KINDS[type];
    const table = sql.raw(descripteur.table);
    const condition = await this.scopes.conditionFor(descripteur.right, action, type);

    const [row] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT ${table}.entity_id AS "entityId", ${table}.name, ${table}.status
          FROM ${table}
         WHERE ${table}.id = ${id}
           AND ${table}.deleted_at IS NULL
           ${condition ? sql`AND ${condition}` : sql``}
      `);

      return resultat.rows;
    });

    if (!row) throw new NotFoundException('Objet introuvable ou hors de votre perimetre.');

    return {
      entityId: Number(row['entityId']),
      name: toText(row['name']),
      status: row['status'] as ItilStatus,
    };
  }

  /**
   * Liens de l'objet, dans les deux sens.
   *
   * Le libellé et le statut de l'autre bout viennent d'un `CASE` sur les trois
   * tables : une jointure par type serait plus lisible, mais rendrait la
   * requête quadratique en nombre de types.
   */
  async linksOf(type: ItilType, id: number): Promise<ItilLink[]> {
    await this.requireObject(type, id, 'read');

    const liens = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<LienRow & Record<string, unknown>>(sql`
        SELECT l.id, l.link_type AS "linkType",
               l.target_type AS "targetType", l.target_id AS "targetId"
          FROM itil_links l
         WHERE l.source_type = ${type} AND l.source_id = ${id}

        UNION ALL

        SELECT l.id, l.link_type,
               l.source_type, l.source_id
          FROM itil_links l
         WHERE l.target_type = ${type} AND l.target_id = ${id}
      `);

      return resultat.rows;
    });

    // Les libellés se lisent objet par objet, à travers la portée de chacun :
    // un lien vers un ticket hors périmètre existe, mais ne se lit pas.
    const resolus: ItilLink[] = [];

    for (const lien of liens) {
      const cible = await this.tryRead(lien.targetType, Number(lien.targetId));

      if (!cible) continue;

      resolus.push({
        id: Number(lien.id),
        linkType: lien.linkType,
        targetType: lien.targetType,
        targetId: Number(lien.targetId),
        targetName: cible.name,
        targetStatus: cible.status,
      });
    }

    return resolus;
  }

  private async tryRead(
    type: ItilType,
    id: number,
  ): Promise<{ name: string; status: ItilStatus } | null> {
    try {
      return await this.requireObject(type, id, 'read');
    } catch {
      return null;
    }
  }

  async create(type: ItilType, id: number, input: CreateLink): Promise<ItilLink[]> {
    const source = await this.requireObject(type, id, 'update');

    if (type === input.targetType && id === input.targetId) {
      throw new BadRequestException('Un objet ne peut pas etre lie a lui-meme.');
    }

    // La cible se lit avec le droit de lecture, pas d'écriture : lier un ticket
    // à un problème ne modifie pas le ticket, seulement la relation.
    await this.requireObject(input.targetType, input.targetId, 'read');

    await this.db.asUser(async (tx) => {
      await tx.execute(sql`
        INSERT INTO itil_links (source_type, source_id, target_type, target_id, link_type)
        VALUES (${type}, ${id}, ${input.targetType}, ${input.targetId}, ${input.linkType})
        ON CONFLICT DO NOTHING
      `);

      await this.history.recordAction(
        tx,
        { type, id, entityId: source.entityId },
        'lien',
        `${input.linkType} -> ${input.targetType}#${String(input.targetId)}`,
      );
    });

    emitEvent('itil.linked', {
      sourceType: type,
      sourceId: id,
      targetType: input.targetType,
      targetId: input.targetId,
      linkType: input.linkType,
    });

    return this.linksOf(type, id);
  }

  async remove(type: ItilType, id: number, linkId: number): Promise<void> {
    const source = await this.requireObject(type, id, 'update');

    const supprimes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ id: number }>(sql`
        DELETE FROM itil_links
         WHERE id = ${linkId}
           AND ((source_type = ${type} AND source_id = ${id})
                OR (target_type = ${type} AND target_id = ${id}))
        RETURNING id
      `);

      if (resultat.rows.length > 0) {
        await this.history.recordAction(
          tx,
          { type, id, entityId: source.entityId },
          'lien retire',
          String(linkId),
        );
      }

      return resultat.rows;
    });

    if (supprimes.length === 0) throw new NotFoundException('Lien introuvable.');

    emitEvent('itil.unlinked', { sourceType: type, sourceId: id, linkId });
  }

  /**
   * Promeut un objet vers un problème ou un changement.
   *
   * L'original reste ouvert, et un lien `linked` rattache les deux. Déplacer le
   * ticket serait plus simple à écrire et faux à l'usage : celui qui l'a
   * signalé attend toujours une réponse sur son incident, indépendamment de
   * l'analyse de fond qui commence.
   *
   * Les demandeurs et observateurs suivent, pas les affectés : qui traitera le
   * problème est une décision de l'encadrement, pas une conséquence mécanique.
   */
  async promote(type: ItilType, id: number, input: Promote): Promise<PromotionResult> {
    const source = await this.requireObject(type, id, 'read');

    if (type === input.to) throw new BadRequestException('Objet deja de ce type.');

    const origine = await this.sourceFields(type, id);
    const acteurs = await this.transferables(type, id);

    // L'urgence et l'impact suivent : un incident critique revele un probleme
    // critique, et repartir de la valeur moyenne effacerait ce que la source
    // avait deja etabli. La priorite, elle, est recalculee par la matrice.
    const cree = await this.objects.create(
      input.to,
      {
        name: input.name ?? source.name,
        content: origine.content,
        urgency: origine.urgency,
        impact: origine.impact,
        categoryId: origine.categoryId,
        checklist: [],
      },
      { acteurs, entityId: source.entityId },
    );

    await this.db.asUser(async (tx) => {
      await tx.execute(sql`
        INSERT INTO itil_links (source_type, source_id, target_type, target_id, link_type)
        VALUES (${type}, ${id}, ${input.to}, ${cree.id}, 'linked')
        ON CONFLICT DO NOTHING
      `);

      await this.history.recordAction(
        tx,
        { type, id, entityId: source.entityId },
        'promotion',
        `${input.to}#${String(cree.id)}`,
      );
    });

    emitEvent('itil.promoted', { fromType: type, fromId: id, toType: input.to, toId: cree.id });

    return { kind: input.to, id: cree.id };
  }

  /** Ce que l'objet promu reprend de sa source. */
  private async sourceFields(
    type: ItilType,
    id: number,
  ): Promise<{ content: string; urgency: number; impact: number; categoryId: number | null }> {
    const table: SQL = sql.raw(ITIL_KINDS[type].table);

    const [row] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(
        sql`SELECT content, urgency, impact, category_id AS "categoryId"
              FROM ${table} WHERE id = ${id}`,
      );

      return resultat.rows;
    });

    return {
      content: toText(row?.['content']),
      urgency: Number(row?.['urgency'] ?? 3),
      impact: Number(row?.['impact'] ?? 3),
      categoryId: row?.['categoryId'] === null ? null : Number(row?.['categoryId']),
    };
  }

  /** Demandeurs et observateurs de la source, à recopier sur l'objet promu. */
  private async transferables(type: ItilType, id: number): Promise<TicketActorInput[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketActorInput & Record<string, unknown>>(sql`
        SELECT role, actor_type AS "actorType", actor_id AS "actorId",
               alternative_email AS "alternativeEmail"
          FROM itil_actors
         WHERE itil_type = ${type} AND itil_id = ${id}
           AND role IN ('requester', 'observer')
      `);

      return resultat.rows.map((row) => ({
        role: row.role,
        actorType: row.actorType,
        actorId: Number(row.actorId),
        alternativeEmail: row.alternativeEmail ?? null,
      }));
    });
  }
}
