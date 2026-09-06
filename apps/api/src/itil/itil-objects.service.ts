import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ItilKind,
  ItilObject,
  ItilObjectFilter,
  ItilObjectSummary,
  ItilStatus,
  TicketActor,
  TicketActorInput,
  UpsertItilObject,
} from '@tick/contracts';
import { itilActors, sql, type SQL, type Transaction } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { entityNames } from '../common/entity-names.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { HistoryService } from '../tickets/history.service.js';
import { PriorityService } from '../tickets/priority.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import {
  actorLabels,
  followupCount,
  taskCount,
  toIso,
  toIsoRequired,
  toText,
} from '../tickets/ticket-sql.js';
import { colonne, ITIL_KINDS } from './itil-kinds.js';

/**
 * Problèmes et changements.
 *
 * Un seul service pour deux objets, parce qu'ils ne diffèrent que par une
 * poignée de colonnes déclarées dans `ITIL_KINDS`. Le ticket garde le sien : il
 * porte des gabarits, des engagements, des règles et une pagination par
 * curseur, dont ni le problème ni le changement n'ont l'usage.
 */
@Injectable()
export class ItilObjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly history: HistoryService,
    private readonly priority: PriorityService,
    private readonly scopes: TicketScopeService,
  ) {}

  /** Table de l'objet, interpolée en SQL brut depuis une constante du code. */
  private table(kind: ItilKind): SQL {
    return sql.raw(ITIL_KINDS[kind].table);
  }

  /** Colonnes propres au type, projetées sous leur nom de contrat. */
  private extraColumns(kind: ItilKind): SQL {
    const table = this.table(kind);

    return sql.join(
      ITIL_KINDS[kind].extra.map(
        (propriete) => sql`${table}.${sql.raw(colonne(propriete))} AS "${sql.raw(propriete)}"`,
      ),
      sql`, `,
    );
  }

  async list(kind: ItilKind, filter: ItilObjectFilter): Promise<ItilObjectSummary[]> {
    const table = this.table(kind);
    const condition = await this.scopes.conditionFor(ITIL_KINDS[kind].right, 'read', kind);
    const conditions: SQL[] = [
      filter.deleted ? sql`${table}.deleted_at IS NOT NULL` : sql`${table}.deleted_at IS NULL`,
    ];

    if (condition) conditions.push(condition);

    if (filter.status) {
      const statuts = filter.status.split(',').filter(Boolean);

      if (statuts.length > 0) {
        conditions.push(
          sql`${table}.status IN (${sql.join(
            statuts.map((statut) => sql`${statut}`),
            sql`, `,
          )})`,
        );
      }
    }

    if (filter.search) {
      const motif = `%${filter.search}%`;

      conditions.push(sql`(${table}.name ILIKE ${motif} OR ${table}.content ILIKE ${motif})`);
    }

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT
          ${table}.id, ${table}.name, ${table}.status,
          ${table}.urgency, ${table}.impact, ${table}.priority,
          ${table}.entity_id AS "entityId",
          ${table}.category_id AS "categoryId", categories.complete_name AS "categoryName",
          ${table}.date_opened AS "dateOpened",
          ${actorLabels('requester', kind)} AS "requesters",
          ${actorLabels('assigned', kind)} AS "assignees",
          ${followupCount(kind)} AS "followupCount",
          ${taskCount(kind)} AS "taskCount"
        FROM ${table}
        LEFT JOIN itil_categories categories ON categories.id = ${table}.category_id
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY ${table}.date_opened DESC, ${table}.id DESC
        LIMIT ${filter.limit}
      `);

      return resultat.rows;
    });

    const noms = await entityNames(
      this.db,
      rows.map((row) => Number(row['entityId'])),
    );

    return rows.map((row) => this.toSummary(kind, row, noms));
  }

  private toSummary(
    kind: ItilKind,
    row: Record<string, unknown>,
    noms: Map<number, string>,
  ): ItilObjectSummary {
    const entityId = Number(row['entityId']);

    return {
      id: Number(row['id']),
      kind,
      name: toText(row['name']),
      status: row['status'] as ItilStatus,
      urgency: Number(row['urgency']),
      impact: Number(row['impact']),
      priority: Number(row['priority']),
      entityId,
      entityName: noms.get(entityId) ?? '',
      categoryId: row['categoryId'] === null ? null : Number(row['categoryId']),
      categoryName: (row['categoryName'] as string | null) ?? null,
      dateOpened: toIsoRequired(row['dateOpened']),
      requesters: (row['requesters'] as string[] | null) ?? [],
      assignees: (row['assignees'] as string[] | null) ?? [],
      followupCount: Number(row['followupCount'] ?? 0),
      taskCount: Number(row['taskCount'] ?? 0),
    };
  }

  async findById(kind: ItilKind, id: number): Promise<ItilObject> {
    const table = this.table(kind);
    const condition = await this.scopes.conditionFor(ITIL_KINDS[kind].right, 'read', kind);

    const [row] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT
          ${table}.id, ${table}.name, ${table}.status, ${table}.content,
          ${table}.urgency, ${table}.impact, ${table}.priority,
          ${table}.entity_id AS "entityId",
          ${table}.category_id AS "categoryId", categories.complete_name AS "categoryName",
          ${table}.location_id AS "locationId", lieux.complete_name AS "locationName",
          ${table}.date_opened AS "dateOpened",
          ${table}.date_solved AS "dateSolved", ${table}.date_closed AS "dateClosed",
          ${table}.internal_time AS "internalTime",
          ${table}.created_by_id AS "createdById", auteur.username AS "createdByName",
          ${table}.updated_at AS "updatedAt",
          ${this.extraColumns(kind)},
          ${actorLabels('requester', kind)} AS "requesters",
          ${actorLabels('assigned', kind)} AS "assignees",
          ${followupCount(kind)} AS "followupCount",
          ${taskCount(kind)} AS "taskCount"
        FROM ${table}
        LEFT JOIN itil_categories categories ON categories.id = ${table}.category_id
        LEFT JOIN locations lieux ON lieux.id = ${table}.location_id
        LEFT JOIN users auteur ON auteur.id = ${table}.created_by_id
        WHERE ${table}.id = ${id}
          ${condition ? sql`AND ${condition}` : sql``}
      `);

      return resultat.rows;
    });

    if (!row) throw new NotFoundException('Objet introuvable ou hors de votre perimetre.');

    const noms = await entityNames(this.db, [Number(row['entityId'])]);

    return {
      ...this.toSummary(kind, row, noms),
      content: toText(row['content']),
      locationId: row['locationId'] === null ? null : Number(row['locationId']),
      locationName: (row['locationName'] as string | null) ?? null,
      dateSolved: toIso(row['dateSolved']),
      dateClosed: toIso(row['dateClosed']),
      internalTime: Number(row['internalTime'] ?? 0),
      createdBy: (row['createdByName'] as string | null) ?? null,
      updatedAt: toIsoRequired(row['updatedAt']),

      symptoms: (row['symptoms'] as string | null) ?? null,
      causes: (row['causes'] as string | null) ?? null,
      impacts: (row['impacts'] as string | null) ?? null,

      deploymentPlan: (row['deploymentPlan'] as string | null) ?? null,
      rollbackPlan: (row['rollbackPlan'] as string | null) ?? null,
      validationPlan: (row['validationPlan'] as string | null) ?? null,
      checklist: (row['checklist'] as ItilObject['checklist'] | null) ?? [],
    };
  }

  /**
   * Crée un problème ou un changement.
   *
   * Les deux options servent la promotion. `acteurs` reporte ceux de l'objet
   * d'origine : sans demandeur parmi eux, l'auteur le devient, mais l'ajouter
   * systématiquement ferait de celui qui promeut un demandeur du problème, ce
   * qu'il n'est pas. `entityId` place l'objet promu là où vit sa cause, plutôt
   * que dans l'entité active du moment : promouvoir depuis la racine un
   * incident d'une filiale ne doit pas remonter l'analyse d'un cran. Le
   * Row-Level Security refuse l'écriture si l'entité est hors du périmètre.
   */
  async create(
    kind: ItilKind,
    input: UpsertItilObject,
    options: { acteurs?: readonly TicketActorInput[]; entityId?: number } = {},
  ): Promise<ItilObject> {
    const context = requireContext();
    const acteurs = options.acteurs ?? [];
    const entityId = options.entityId ?? context.entityId;

    await this.scopes.conditionFor(ITIL_KINDS[kind].right, 'create', kind);

    const priority = await this.priority.compute(entityId, input.urgency, input.impact);
    const valeurs = this.writableValues(kind, input);

    const id = await this.db.asUser(async (tx) => {
      const colonnes = [
        sql.raw('entity_id'),
        sql.raw('entity_path'),
        sql.raw('priority'),
        sql.raw('created_by_id'),
        sql.raw('updated_by_id'),
        ...valeurs.map(([nom]) => sql.raw(nom)),
      ];
      const donnees = [
        sql`${entityId}`,
        // Recalculé par le déclencheur depuis `entity_id`, comme pour le ticket.
        sql`'temporaire'::ltree`,
        sql`${priority}`,
        sql`${context.userId}`,
        sql`${context.userId}`,
        ...valeurs.map(([, valeur]) => valeur),
      ];

      const resultat = await tx.execute<{ id: number }>(sql`
        INSERT INTO ${this.table(kind)} (${sql.join(colonnes, sql`, `)})
        VALUES (${sql.join(donnees, sql`, `)})
        RETURNING id
      `);

      const [ligne] = resultat.rows;

      if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');

      await this.writeActors(
        tx,
        kind,
        ligne.id,
        acteurs.some((acteur) => acteur.role === 'requester')
          ? acteurs
          : [...acteurs, { role: 'requester', actorType: 'user', actorId: context.userId }],
      );

      await this.history.recordAction(
        tx,
        { type: kind, id: ligne.id, entityId },
        'creation',
        input.name,
      );

      return ligne.id;
    });

    emitEvent(`${kind}.created`, { id, entityId, name: input.name });

    return this.findById(kind, id);
  }

  async update(kind: ItilKind, id: number, input: UpsertItilObject): Promise<ItilObject> {
    const context = requireContext();
    const avant = await this.findById(kind, id);

    await this.scopes.conditionFor(ITIL_KINDS[kind].right, 'update', kind);

    const priority =
      input.urgency === avant.urgency && input.impact === avant.impact
        ? avant.priority
        : await this.priority.compute(avant.entityId, input.urgency, input.impact);

    const valeurs = this.writableValues(kind, input);

    await this.db.asUser(async (tx) => {
      const affectations = [
        sql`priority = ${priority}`,
        sql`updated_by_id = ${context.userId}`,
        sql`updated_at = now()`,
        ...valeurs.map(([nom, valeur]) => sql`${sql.raw(nom)} = ${valeur}`),
      ];

      await tx.execute(sql`
        UPDATE ${this.table(kind)}
           SET ${sql.join(affectations, sql`, `)}
         WHERE id = ${id}
      `);

      await this.history.recordChanges(
        tx,
        { type: kind, id, entityId: avant.entityId },
        avant,
        {
          name: input.name,
          content: input.content,
          status: input.status ?? avant.status,
          urgency: input.urgency,
          impact: input.impact,
        },
      );
    });

    emitEvent(`${kind}.updated`, { id, entityId: avant.entityId });

    return this.findById(kind, id);
  }

  /**
   * Valeurs écrivables, colonne par colonne.
   *
   * Construite depuis le descripteur plutôt qu'écrite deux fois : ajouter un
   * champ à un problème ne demande alors qu'une ligne dans `ITIL_KINDS`, et le
   * champ d'un changement ne peut pas se retrouver sur un problème.
   */
  private writableValues(kind: ItilKind, input: UpsertItilObject): [string, SQL][] {
    const socle: [string, SQL][] = [
      ['name', sql`${input.name}`],
      ['content', sql`${input.content}`],
      ['urgency', sql`${input.urgency}`],
      ['impact', sql`${input.impact}`],
      ['category_id', sql`${input.categoryId ?? null}`],
      ['location_id', sql`${input.locationId ?? null}`],
    ];

    if (input.status) socle.push(['status', sql`${input.status}`]);

    const donnees = input as unknown as Record<string, unknown>;

    for (const propriete of ITIL_KINDS[kind].extra) {
      const valeur = donnees[propriete];

      if (propriete === 'checklist') {
        socle.push([colonne(propriete), sql`${JSON.stringify(valeur ?? [])}::jsonb`]);
        continue;
      }

      socle.push([colonne(propriete), sql`${(valeur as string | null | undefined) ?? null}`]);
    }

    return socle;
  }

  async softDelete(kind: ItilKind, id: number): Promise<void> {
    const avant = await this.findById(kind, id);

    await this.scopes.conditionFor(ITIL_KINDS[kind].right, 'delete', kind);

    await this.db.asUser(async (tx) => {
      await tx.execute(sql`
        UPDATE ${this.table(kind)} SET deleted_at = now() WHERE id = ${id}
      `);

      await this.history.recordAction(
        tx,
        { type: kind, id, entityId: avant.entityId },
        'suppression',
      );
    });

    emitEvent(`${kind}.deleted`, { id, entityId: avant.entityId });
  }

  /** Acteurs de l'objet, tous rôles et toutes natures confondus. */
  async actorsOf(kind: ItilKind, id: number): Promise<TicketActor[]> {
    await this.findById(kind, id);

    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketActor & Record<string, unknown>>(sql`
        SELECT
          acteur.role, acteur.actor_type AS "actorType", acteur.actor_id AS "actorId",
          acteur.alternative_email AS "alternativeEmail",
          coalesce(
            CASE acteur.actor_type
              WHEN 'user' THEN coalesce(
                nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                u.username::text
              )
              WHEN 'group' THEN g.name
              WHEN 'supplier' THEN f.name
            END,
            '(inconnu)'
          ) AS "label"
        FROM itil_actors acteur
        LEFT JOIN users u ON acteur.actor_type = 'user' AND u.id = acteur.actor_id
        LEFT JOIN groups g ON acteur.actor_type = 'group' AND g.id = acteur.actor_id
        LEFT JOIN suppliers f ON acteur.actor_type = 'supplier' AND f.id = acteur.actor_id
        WHERE acteur.itil_type = ${kind} AND acteur.itil_id = ${id}
        ORDER BY acteur.role, "label"
      `);

      return resultat.rows;
    });
  }

  async setActors(
    kind: ItilKind,
    id: number,
    acteurs: readonly TicketActorInput[],
  ): Promise<TicketActor[]> {
    const avant = await this.findById(kind, id);

    await this.scopes.conditionFor(ITIL_KINDS[kind].right, 'update', kind);

    if (!acteurs.some((acteur) => acteur.role === 'requester')) {
      throw new BadRequestException('Un objet doit conserver au moins un demandeur.');
    }

    await this.db.asUser(async (tx) => {
      await tx
        .delete(itilActors)
        .where(sql`${itilActors.itilType} = ${kind} AND ${itilActors.itilId} = ${id}`);
      await this.writeActors(tx, kind, id, acteurs);
      await this.history.recordAction(
        tx,
        { type: kind, id, entityId: avant.entityId },
        'acteurs',
        acteurs
          .map((acteur) => `${acteur.role}:${acteur.actorType}#${String(acteur.actorId)}`)
          .join(', '),
      );
    });

    return this.actorsOf(kind, id);
  }

  /** Écrit des acteurs sans effacer les existants. */
  async writeActors(
    tx: Transaction,
    kind: ItilKind,
    id: number,
    acteurs: readonly TicketActorInput[],
  ): Promise<void> {
    if (acteurs.length === 0) return;

    await tx
      .insert(itilActors)
      .values(
        acteurs.map((acteur) => ({
          itilType: kind,
          itilId: id,
          role: acteur.role,
          actorType: acteur.actorType,
          actorId: acteur.actorId,
          alternativeEmail: acteur.alternativeEmail ?? null,
        })),
      )
      .onConflictDoNothing();
  }
}
