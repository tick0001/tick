import { BadRequestException, Injectable } from '@nestjs/common';
import type { PlanningEntry, PlanningFilter, UpsertUnavailability } from '@tick/contracts';
import { sql, unavailabilities, type SQL } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import { toIsoRequired, toText } from '../tickets/ticket-sql.js';

/**
 * Fenêtre maximale consultable, en jours.
 *
 * Le planning se lit par jour, semaine ou mois. Au-delà d'un trimestre, la
 * requête ramènerait des milliers d'entrées qu'aucune vue calendrier n'affiche
 * — et la détection de conflits, quadratique par technicien, s'en ressentirait.
 */
const FENETRE_MAX_JOURS = 100;

interface EntreeBrute extends Record<string, unknown> {
  kind: 'task' | 'unavailability';
  id: number;
  beginAt: unknown;
  endAt: unknown;
  title: unknown;
  userId: number | null;
  userName: string | null;
  groupId: number | null;
  groupName: string | null;
  itilType: 'ticket' | 'problem' | 'change' | null;
  itilId: number | null;
  state: 'information' | 'todo' | 'done' | null;
}

/**
 * Planning des tâches et des indisponibilités.
 *
 * Les deux natures sortent d'une seule requête, dans une seule liste. La vue
 * calendrier les superpose de toute façon, et surtout : un conflit se détecte
 * entre une tâche et une absence aussi bien qu'entre deux tâches. Deux listes
 * séparées auraient obligé à recomposer avant de pouvoir chercher.
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly db: DatabaseService,
    private readonly scopes: TicketScopeService,
  ) {}

  async list(filter: PlanningFilter): Promise<PlanningEntry[]> {
    const debut = new Date(filter.from);
    const fin = new Date(filter.to);

    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
      throw new BadRequestException('Fenetre de planning invalide.');
    }

    if (fin.getTime() <= debut.getTime()) {
      throw new BadRequestException('La fin du planning precede son debut.');
    }

    if (fin.getTime() - debut.getTime() > FENETRE_MAX_JOURS * 86_400_000) {
      throw new BadRequestException(
        `Fenetre trop large : ${String(FENETRE_MAX_JOURS)} jours au maximum.`,
      );
    }

    // La portée du droit sur les tickets décide de ce qui est visible : une
    // tâche est un satellite, et le planning ne doit pas en montrer plus que la
    // fiche dont elle dépend.
    await this.scopes.conditionFor('ticket', 'read');

    const filtres: SQL[] = [];

    if (filter.technicianId) filtres.push(sql`e."userId" = ${filter.technicianId}`);
    if (filter.groupId) filtres.push(sql`e."groupId" = ${filter.groupId}`);

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<EntreeBrute>(sql`
        SELECT * FROM (
          SELECT 'task' AS kind, k.id,
                 k.begin_at AS "beginAt", k.end_at AS "endAt",
                 k.content AS title,
                 k.technician_id AS "userId",
                 coalesce(
                   nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                   u.username::text
                 ) AS "userName",
                 k.group_id AS "groupId", g.name AS "groupName",
                 k.itil_type::text AS "itilType", k.itil_id AS "itilId",
                 k.state::text AS state
            FROM itil_tasks k
            LEFT JOIN users u ON u.id = k.technician_id
            LEFT JOIN groups g ON g.id = k.group_id
           WHERE k.deleted_at IS NULL
             AND k.begin_at IS NOT NULL AND k.end_at IS NOT NULL
             AND k.begin_at < ${fin} AND k.end_at > ${debut}

          UNION ALL

          SELECT 'unavailability', i.id,
                 i.begin_at, i.end_at,
                 i.reason,
                 i.user_id,
                 coalesce(
                   nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                   u.username::text
                 ),
                 NULL, NULL,
                 NULL, NULL,
                 NULL
            FROM unavailabilities i
            JOIN users u ON u.id = i.user_id
           WHERE i.begin_at < ${fin} AND i.end_at > ${debut}
        ) e
        ${filtres.length > 0 ? sql`WHERE ${sql.join(filtres, sql` AND `)}` : sql``}
        ORDER BY e."beginAt", e.id
      `);

      return resultat.rows;
    });

    return marqueConflits(
      rows.map((row) => ({
        kind: row.kind,
        id: Number(row.id),
        beginAt: toIsoRequired(row.beginAt),
        endAt: toIsoRequired(row.endAt),
        title: toText(row.title) || '—',
        userId: row.userId === null ? null : Number(row.userId),
        userName: row.userName,
        groupId: row.groupId === null ? null : Number(row.groupId),
        groupName: row.groupName,
        itilType: row.itilType,
        itilId: row.itilId === null ? null : Number(row.itilId),
        state: row.state,
        conflicts: [],
      })),
    );
  }

  async createUnavailability(input: UpsertUnavailability): Promise<void> {
    const context = requireContext();
    const debut = new Date(input.beginAt);
    const fin = new Date(input.endAt);

    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
      throw new BadRequestException('Dates invalides.');
    }

    if (fin.getTime() <= debut.getTime()) {
      throw new BadRequestException('La fin precede le debut.');
    }

    await this.db.asUser(async (tx) => {
      await tx.insert(unavailabilities).values({
        entityId: context.entityId,
        // Recalculé par le déclencheur depuis `entity_id`.
        entityPath: 'temporaire',
        userId: input.userId,
        beginAt: debut,
        endAt: fin,
        reason: input.reason,
        createdById: context.userId,
      });
    });
  }

  async removeUnavailability(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      await tx.delete(unavailabilities).where(sql`${unavailabilities.id} = ${id}`);
    });
  }
}

/**
 * Marque les chevauchements, technicien par technicien.
 *
 * Un conflit n'existe qu'entre entrées d'une même personne : deux techniciens
 * occupés au même moment, c'est une équipe qui travaille. Les entrées sans
 * technicien — une tâche affectée à un groupe seulement — n'entrent donc dans
 * aucun conflit : personne n'est encore engagé.
 *
 * Le balayage est linéaire par technicien après le tri par date de début, que
 * la requête a déjà fait : on ne compare qu'aux entrées encore ouvertes.
 */
export function marqueConflits(entrees: PlanningEntry[]): PlanningEntry[] {
  const parTechnicien = new Map<number, PlanningEntry[]>();

  for (const entree of entrees) {
    if (entree.userId === null) continue;

    const groupe = parTechnicien.get(entree.userId) ?? [];

    groupe.push(entree);
    parTechnicien.set(entree.userId, groupe);
  }

  for (const groupe of parTechnicien.values()) {
    const ouvertes: PlanningEntry[] = [];

    for (const entree of groupe) {
      const debut = Date.parse(entree.beginAt);

      // Les entrées déjà terminées ne peuvent plus chevaucher les suivantes,
      // qui commencent toutes plus tard.
      for (let i = ouvertes.length - 1; i >= 0; i -= 1) {
        const candidate = ouvertes[i];

        if (!candidate) continue;

        if (Date.parse(candidate.endAt) <= debut) {
          ouvertes.splice(i, 1);
          continue;
        }

        candidate.conflicts.push(entree.id);
        entree.conflicts.push(candidate.id);
      }

      ouvertes.push(entree);
    }
  }

  return entrees;
}
