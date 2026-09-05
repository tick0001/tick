import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Agreement, Calendar, UpsertAgreement, UpsertCalendar } from '@tick/contracts';
import {
  agreementLevelActions,
  agreementLevels,
  agreements,
  calendarSegments,
  calendars,
  holidays,
  sql,
} from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { isKnownTimezone, type WorkingCalendar } from './working-time.js';

interface CalendarRow extends Record<string, unknown> {
  id: number;
  name: string;
  comment: string | null;
  timezone: string;
  entityId: number;
  isRecursive: boolean;
  segments: unknown;
  holidays: unknown;
}

interface AgreementRow extends Record<string, unknown> {
  id: number;
  kind: 'sla' | 'ola';
  axis: 'tto' | 'ttr';
  name: string;
  comment: string | null;
  duration: number;
  calendarId: number | null;
  calendarName: string | null;
  entityId: number;
  isRecursive: boolean;
  levels: unknown;
}

/**
 * Calendriers et engagements de service.
 *
 * Les deux vivent ensemble parce qu'ils ne se comprennent qu'ensemble : une
 * durée d'engagement n'a de sens que rapportée à des heures d'ouverture, et un
 * calendrier sans engagement ne sert à rien.
 */
@Injectable()
export class SlmService {
  constructor(private readonly db: DatabaseService) {}

  // --- Calendriers -----------------------------------------------------------

  async listCalendars(): Promise<Calendar[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<CalendarRow>(sql`
        ${this.calendarSelection()} WHERE c.deleted_at IS NULL ORDER BY c.name
      `);

      return resultat.rows;
    });

    return this.nommerCalendriers(rows);
  }

  async findCalendar(id: number): Promise<Calendar> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<CalendarRow>(sql`
        ${this.calendarSelection()} WHERE c.id = ${id} AND c.deleted_at IS NULL
      `);

      return resultat.rows;
    });

    const [calendrier] = await this.nommerCalendriers(rows);

    if (!calendrier) throw new NotFoundException('Calendrier introuvable dans ce perimetre.');

    return calendrier;
  }

  async saveCalendar(input: UpsertCalendar, id?: number): Promise<Calendar> {
    if (!isKnownTimezone(input.timezone)) {
      throw new BadRequestException(`Fuseau horaire inconnu : ${input.timezone}.`);
    }

    for (const segment of input.segments) {
      if (segment.beginAt >= segment.endAt) {
        throw new BadRequestException(
          `Plage invalide : ${segment.beginAt} n'est pas avant ${segment.endAt}.`,
        );
      }
    }

    const context = requireContext();

    const calendarId = await this.db.asUser(async (tx) => {
      let cible = id;

      if (cible) {
        const resultat = await tx.execute(sql`
          UPDATE calendars
             SET name = ${input.name}, comment = ${input.comment ?? null},
                 timezone = ${input.timezone}, is_recursive = ${input.isRecursive},
                 updated_at = now()
           WHERE id = ${cible} AND deleted_at IS NULL
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Calendrier introuvable dans ce perimetre.');
        }
      } else {
        const [ligne] = await tx
          .insert(calendars)
          .values({
            entityId: context.entityId,
            entityPath: 'temporaire',
            name: input.name,
            comment: input.comment ?? null,
            timezone: input.timezone,
            isRecursive: input.isRecursive,
          })
          .returning({ id: calendars.id });

        if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');
        cible = ligne.id;
      }

      await tx.execute(sql`DELETE FROM calendar_segments WHERE calendar_id = ${cible}`);
      await tx.execute(sql`DELETE FROM holidays WHERE calendar_id = ${cible}`);

      if (input.segments.length > 0) {
        await tx.insert(calendarSegments).values(
          input.segments.map((segment) => ({
            calendarId: cible,
            weekday: segment.weekday,
            beginAt: segment.beginAt,
            endAt: segment.endAt,
          })),
        );
      }

      if (input.holidays.length > 0) {
        await tx.insert(holidays).values(
          input.holidays.map((ferie) => ({
            calendarId: cible,
            name: ferie.name,
            day: ferie.day,
            isPerpetual: ferie.isPerpetual,
          })),
        );
      }

      return cible;
    });

    return this.findCalendar(calendarId);
  }

  async removeCalendar(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(
        sql`UPDATE calendars SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`,
      );

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Calendrier introuvable dans ce perimetre.');
      }
    });
  }

  /**
   * Charge un calendrier pour le calcul, hors Row-Level Security.
   *
   * Le calcul d'échéance tourne aussi en tâche de fond, sans utilisateur
   * connecté. Lire le calendrier en propriétaire est sans risque : c'est une
   * donnée de paramétrage, elle ne révèle aucun ticket, et l'identifiant vient
   * toujours d'un engagement déjà résolu dans le périmètre.
   */
  async workingCalendar(id: number | null | undefined): Promise<WorkingCalendar | null> {
    if (!id) return null;

    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{
        timezone: string;
        segments: unknown;
        holidays: unknown;
      }>(sql`
        SELECT c.timezone,
               COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'weekday', s.weekday, 'beginAt', s.begin_at, 'endAt', s.end_at))
                           FROM calendar_segments s WHERE s.calendar_id = c.id),
                        '[]'::jsonb) AS segments,
               COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'day', h.day, 'isPerpetual', h.is_perpetual))
                           FROM holidays h WHERE h.calendar_id = c.id),
                        '[]'::jsonb) AS holidays
          FROM calendars c
         WHERE c.id = ${id} AND c.deleted_at IS NULL
      `);

      const row = resultat.rows[0];

      if (!row) return null;

      return {
        timezone: row.timezone,
        segments: Array.isArray(row.segments) ? (row.segments as WorkingCalendar['segments']) : [],
        holidays: Array.isArray(row.holidays) ? (row.holidays as WorkingCalendar['holidays']) : [],
      };
    });
  }

  // --- Engagements -----------------------------------------------------------

  async listAgreements(): Promise<Agreement[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<AgreementRow>(sql`
        ${this.agreementSelection()} WHERE a.deleted_at IS NULL ORDER BY a.kind, a.axis, a.name
      `);

      return resultat.rows;
    });

    return this.nommerEngagements(rows);
  }

  async findAgreement(id: number): Promise<Agreement> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<AgreementRow>(sql`
        ${this.agreementSelection()} WHERE a.id = ${id} AND a.deleted_at IS NULL
      `);

      return resultat.rows;
    });

    const [engagement] = await this.nommerEngagements(rows);

    if (!engagement) throw new NotFoundException('Engagement introuvable dans ce perimetre.');

    return engagement;
  }

  async saveAgreement(input: UpsertAgreement, id?: number): Promise<Agreement> {
    const context = requireContext();

    const agreementId = await this.db.asUser(async (tx) => {
      let cible = id;

      if (cible) {
        const resultat = await tx.execute(sql`
          UPDATE agreements
             SET kind = ${input.kind}, axis = ${input.axis}, name = ${input.name},
                 comment = ${input.comment ?? null}, duration = ${input.duration},
                 calendar_id = ${input.calendarId ?? null},
                 is_recursive = ${input.isRecursive}, updated_at = now()
           WHERE id = ${cible} AND deleted_at IS NULL
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Engagement introuvable dans ce perimetre.');
        }
      } else {
        const [ligne] = await tx
          .insert(agreements)
          .values({
            entityId: context.entityId,
            entityPath: 'temporaire',
            kind: input.kind,
            axis: input.axis,
            name: input.name,
            comment: input.comment ?? null,
            duration: input.duration,
            calendarId: input.calendarId ?? null,
            isRecursive: input.isRecursive,
          })
          .returning({ id: agreements.id });

        if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');
        cible = ligne.id;
      }

      // Les niveaux sont remplacés en bloc. La cascade emporte leurs actions, et
      // `ticket_escalations` avec elles : c'est voulu, un niveau réécrit n'est
      // plus le niveau déjà déclenché.
      await tx.execute(sql`DELETE FROM agreement_levels WHERE agreement_id = ${cible}`);

      for (const niveau of input.levels) {
        const [ligne] = await tx
          .insert(agreementLevels)
          .values({
            agreementId: cible,
            name: niveau.name,
            offsetSeconds: niveau.offsetSeconds,
            isActive: niveau.isActive,
          })
          .returning({ id: agreementLevels.id });

        if (!ligne || niveau.actions.length === 0) continue;

        await tx.insert(agreementLevelActions).values(
          niveau.actions.map((action) => ({
            levelId: ligne.id,
            action: action.action,
            value: action.value ?? null,
          })),
        );
      }

      return cible;
    });

    return this.findAgreement(agreementId);
  }

  async removeAgreement(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(
        sql`UPDATE agreements SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`,
      );

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Engagement introuvable dans ce perimetre.');
      }
    });
  }

  private calendarSelection() {
    return sql`
      SELECT c.id, c.name, c.comment, c.timezone, c.is_recursive AS "isRecursive",
             c.entity_id AS "entityId",
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'weekday', s.weekday, 'beginAt', s.begin_at, 'endAt', s.end_at)
                       ORDER BY s.weekday, s.begin_at)
                         FROM calendar_segments s WHERE s.calendar_id = c.id),
                      '[]'::jsonb) AS segments,
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'id', h.id, 'name', h.name, 'day', h.day,
                         'isPerpetual', h.is_perpetual) ORDER BY h.day)
                         FROM holidays h WHERE h.calendar_id = c.id),
                      '[]'::jsonb) AS holidays
        FROM calendars c
    `;
  }

  private agreementSelection() {
    return sql`
      SELECT a.id, a.kind, a.axis, a.name, a.comment, a.duration,
             a.calendar_id AS "calendarId", c.name AS "calendarName",
             a.is_recursive AS "isRecursive",
             a.entity_id AS "entityId",
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'id', n.id, 'name', n.name,
                         'offsetSeconds', n.offset_seconds, 'isActive', n.is_active,
                         'actions', COALESCE(
                           (SELECT jsonb_agg(jsonb_build_object('action', t.action, 'value', t.value)
                                             ORDER BY t.id)
                              FROM agreement_level_actions t WHERE t.level_id = n.id),
                           '[]'::jsonb))
                       ORDER BY n.offset_seconds)
                         FROM agreement_levels n WHERE n.agreement_id = a.id),
                      '[]'::jsonb) AS levels
        FROM agreements a
        LEFT JOIN calendars c ON c.id = a.calendar_id
    `;
  }

  /**
   * Complete les lignes avec le nom de leur entite.
   *
   * Resolu a part et non par une jointure : voir `entityNames`, une jointure
   * sur `entities` ferait disparaitre tout objet herite d'un ancetre.
   */
  private async nommerCalendriers(rows: readonly CalendarRow[]): Promise<Calendar[]> {
    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    return rows.map((row) => this.toCalendar(row, noms));
  }

  private async nommerEngagements(rows: readonly AgreementRow[]): Promise<Agreement[]> {
    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    return rows.map((row) => this.toAgreement(row, noms));
  }

  private toCalendar(row: CalendarRow, noms: Map<number, string>): Calendar {
    return {
      id: row.id,
      name: row.name,
      comment: row.comment,
      timezone: row.timezone,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      isRecursive: row.isRecursive,
      segments: Array.isArray(row.segments) ? (row.segments as Calendar['segments']) : [],
      holidays: Array.isArray(row.holidays) ? (row.holidays as Calendar['holidays']) : [],
    };
  }

  private toAgreement(row: AgreementRow, noms: Map<number, string>): Agreement {
    return {
      id: row.id,
      kind: row.kind,
      axis: row.axis,
      name: row.name,
      comment: row.comment,
      duration: row.duration,
      calendarId: row.calendarId,
      calendarName: row.calendarName,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      isRecursive: row.isRecursive,
      levels: Array.isArray(row.levels) ? (row.levels as Agreement['levels']) : [],
    };
  }
}
