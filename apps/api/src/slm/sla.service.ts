import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AgreementAxis, AgreementKind, TicketAgreement } from '@tick/contracts';
import { sql } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import { SlmService } from './slm.service.js';
import {
  addWorkingSeconds,
  subtractWorkingSeconds,
  workingSecondsBetween,
  type WorkingCalendar,
} from './working-time.js';

/** Colonne du ticket portant chaque engagement, et échéance associée. */
/** Normalise un horodatage venu du SQL brut. */
function asDate(valeur: unknown): Date {
  return valeur instanceof Date ? valeur : new Date(String(valeur));
}

const AXES = [
  { colonne: 'sla_tto_id', echeance: 'date_due_own', kind: 'sla', axis: 'tto' },
  { colonne: 'sla_ttr_id', echeance: 'date_due', kind: 'sla', axis: 'ttr' },
  { colonne: 'ola_tto_id', echeance: 'date_due_own_internal', kind: 'ola', axis: 'tto' },
  { colonne: 'ola_ttr_id', echeance: 'date_due_internal', kind: 'ola', axis: 'ttr' },
] as const satisfies readonly {
  colonne: string;
  echeance: string;
  kind: AgreementKind;
  axis: AgreementAxis;
}[];

interface TicketSlaRow extends Record<string, unknown> {
  id: number;
  /**
   * Volontairement non typee `Date`.
   *
   * Le pilote rend les horodatages du SQL brut sous forme de chaines : les
   * declarer `Date` compilerait sans broncher et echouerait a l'execution, une
   * fois seulement qu'un engagement serait effectivement applique.
   */
  dateOpened: unknown;
  waitingDuration: number;
  dateTakenIntoAccount: unknown;
  dateSolved: unknown;
  slaTtoId: number | null;
  slaTtrId: number | null;
  olaTtoId: number | null;
  olaTtrId: number | null;
}

interface LevelRow extends Record<string, unknown> {
  id: number;
  agreementId: number;
  offsetSeconds: number;
}

interface AgreementSpec extends Record<string, unknown> {
  id: number;
  name: string;
  duration: number;
  calendarId: number | null;
}

/**
 * Application des engagements à un ticket.
 *
 * Les quatre échéances sont **recalculées** à partir de la date d'ouverture et
 * du temps d'attente cumulé, jamais décalées pas à pas. Un calcul incrémental
 * dériverait au fil des suspensions successives, et deux tickets identiques
 * finiraient avec des échéances différentes selon leur historique de statuts.
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly slm: SlmService,
  ) {}

  /**
   * Recalcule les échéances et la prochaine escalade d'un ticket.
   *
   * Passe par le rôle propriétaire : le recalcul suit aussi bien une mise à
   * jour faite par un utilisateur qu'un balayage de tâche de fond, qui n'a
   * aucun contexte d'entité. L'identifiant du ticket a toujours été résolu dans
   * le périmètre de l'appelant avant d'arriver ici.
   */
  async refresh(ticketId: number): Promise<void> {
    const ticket = await this.load(ticketId);

    if (!ticket) return;

    const echeances = new Map<string, Date | null>();
    const calendriers = new Map<number, WorkingCalendar | null>();

    for (const axe of AXES) {
      const engagement = await this.agreement(this.agreementId(ticket, axe.kind, axe.axis));

      if (!engagement) {
        echeances.set(axe.echeance, null);
        continue;
      }

      const calendrier = await this.calendar(calendriers, engagement.calendarId);

      // Le temps passé en attente s'ajoute à la durée de l'engagement : il ne
      // se retranche pas du délai constaté, il repousse l'échéance.
      echeances.set(
        axe.echeance,
        addWorkingSeconds(
          calendrier,
          asDate(ticket.dateOpened),
          engagement.duration + ticket.waitingDuration,
        ),
      );
    }

    const prochaine = await this.nextEscalation(ticket, echeances, calendriers);

    await this.db.asOwner((tx) =>
      tx.execute(sql`
        UPDATE tickets
           SET date_due_own = ${echeances.get('date_due_own') ?? null},
               date_due = ${echeances.get('date_due') ?? null},
               date_due_own_internal = ${echeances.get('date_due_own_internal') ?? null},
               date_due_internal = ${echeances.get('date_due_internal') ?? null},
               escalation_level_id = ${prochaine?.levelId ?? null},
               escalation_at = ${prochaine?.at ?? null}
         WHERE id = ${ticketId}
      `),
    );
  }

  /**
   * État des engagements d'un ticket, pour affichage.
   *
   * Lu sous Row-Level Security : c'est une information de ticket, donc soumise
   * au périmètre de celui qui la demande.
   */
  async statusOf(ticketId: number): Promise<TicketAgreement[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketSlaRow & Record<string, unknown>>(sql`
        SELECT id, date_opened AS "dateOpened", waiting_duration AS "waitingDuration",
               date_taken_into_account AS "dateTakenIntoAccount",
               date_solved AS "dateSolved",
               sla_tto_id AS "slaTtoId", sla_ttr_id AS "slaTtrId",
               ola_tto_id AS "olaTtoId", ola_ttr_id AS "olaTtrId",
               date_due_own AS "dateDueOwn", date_due AS "dateDue",
               date_due_own_internal AS "dateDueOwnInternal",
               date_due_internal AS "dateDueInternal"
          FROM tickets WHERE id = ${ticketId} AND deleted_at IS NULL
      `);

      return resultat.rows;
    });

    const ticket = rows[0];

    if (!ticket) throw new NotFoundException('Ticket introuvable ou hors de votre perimetre.');

    const maintenant = new Date();
    const etats: TicketAgreement[] = [];
    const calendriers = new Map<number, WorkingCalendar | null>();
    const colonnes: Record<string, string> = {
      date_due_own: 'dateDueOwn',
      date_due: 'dateDue',
      date_due_own_internal: 'dateDueOwnInternal',
      date_due_internal: 'dateDueInternal',
    };

    for (const axe of AXES) {
      const identifiant = this.agreementId(ticket, axe.kind, axe.axis);
      const engagement = await this.agreement(identifiant);
      const brut = ticket[colonnes[axe.echeance] ?? ''];

      if (!engagement || !identifiant || !brut) continue;

      const echeance = asDate(brut);
      const calendrier = await this.calendar(calendriers, engagement.calendarId);
      const atteint = this.satisfied(ticket, axe.axis);
      const restant =
        echeance.getTime() >= maintenant.getTime()
          ? workingSecondsBetween(calendrier, maintenant, echeance)
          : -workingSecondsBetween(calendrier, echeance, maintenant);

      etats.push({
        axis: axe.axis,
        kind: axe.kind,
        agreementId: identifiant,
        name: engagement.name,
        dueAt: echeance.toISOString(),
        // Un axe déjà satisfait ne peut plus être dépassé : la prise en compte
        // faite hier reste faite, même si l'échéance est passée depuis.
        isBreached: !atteint && echeance.getTime() < maintenant.getTime(),
        remainingSeconds: restant,
      });
    }

    return etats;
  }

  /**
   * Choisit le prochain niveau d'escalade à déclencher.
   *
   * Un seul niveau est planifié à la fois, et il est réévalué après chaque
   * exécution : sans cela, décaler une échéance laisserait derrière elle des
   * escalades programmées sur l'ancienne date.
   */
  private async nextEscalation(
    ticket: TicketSlaRow,
    echeances: Map<string, Date | null>,
    calendriers: Map<number, WorkingCalendar | null>,
  ): Promise<{ levelId: number; at: Date } | null> {
    const executes = await this.executedLevels(ticket.id);
    let meilleur: { levelId: number; at: Date } | null = null;

    for (const axe of AXES) {
      const identifiant = this.agreementId(ticket, axe.kind, axe.axis);
      const echeance = echeances.get(axe.echeance);

      if (!identifiant || !echeance || this.satisfied(ticket, axe.axis)) continue;

      const engagement = await this.agreement(identifiant);
      const calendrier = await this.calendar(calendriers, engagement?.calendarId ?? null);

      for (const niveau of await this.levels(identifiant)) {
        if (executes.has(niveau.id)) continue;

        const at =
          niveau.offsetSeconds < 0
            ? subtractWorkingSeconds(calendrier, echeance, -niveau.offsetSeconds)
            : addWorkingSeconds(calendrier, echeance, niveau.offsetSeconds);

        if (!meilleur || at.getTime() < meilleur.at.getTime()) {
          meilleur = { levelId: niveau.id, at };
        }
      }
    }

    return meilleur;
  }

  /** Un axe est satisfait quand l'événement qu'il mesure a eu lieu. */
  private satisfied(ticket: TicketSlaRow, axis: AgreementAxis): boolean {
    const marque = axis === 'tto' ? ticket.dateTakenIntoAccount : ticket.dateSolved;

    return marque !== null && marque !== undefined;
  }

  private agreementId(
    ticket: TicketSlaRow,
    kind: AgreementKind,
    axis: AgreementAxis,
  ): number | null {
    if (kind === 'sla') return axis === 'tto' ? ticket.slaTtoId : ticket.slaTtrId;

    return axis === 'tto' ? ticket.olaTtoId : ticket.olaTtrId;
  }

  private async load(ticketId: number): Promise<TicketSlaRow | null> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<TicketSlaRow>(sql`
        SELECT id, date_opened AS "dateOpened", waiting_duration AS "waitingDuration",
               date_taken_into_account AS "dateTakenIntoAccount",
               date_solved AS "dateSolved",
               sla_tto_id AS "slaTtoId", sla_ttr_id AS "slaTtrId",
               ola_tto_id AS "olaTtoId", ola_ttr_id AS "olaTtrId"
          FROM tickets WHERE id = ${ticketId} AND deleted_at IS NULL
      `);

      return resultat.rows;
    });

    return rows[0] ?? null;
  }

  private async agreement(id: number | null): Promise<AgreementSpec | null> {
    if (!id) return null;

    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<AgreementSpec>(sql`
        SELECT id, name, duration, calendar_id AS "calendarId"
          FROM agreements WHERE id = ${id} AND deleted_at IS NULL
      `);

      return resultat.rows;
    });

    return rows[0] ?? null;
  }

  private async levels(agreementId: number): Promise<LevelRow[]> {
    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<LevelRow>(sql`
        SELECT id, agreement_id AS "agreementId", offset_seconds AS "offsetSeconds"
          FROM agreement_levels
         WHERE agreement_id = ${agreementId} AND is_active
         ORDER BY offset_seconds
      `);

      return resultat.rows;
    });
  }

  private async executedLevels(ticketId: number): Promise<Set<number>> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ levelId: number }>(
        sql`SELECT level_id AS "levelId" FROM ticket_escalations WHERE ticket_id = ${ticketId}`,
      );

      return resultat.rows;
    });

    return new Set(rows.map((row) => row.levelId));
  }

  /** Cache local : quatre engagements partagent souvent le même calendrier. */
  private async calendar(
    cache: Map<number, WorkingCalendar | null>,
    id: number | null,
  ): Promise<WorkingCalendar | null> {
    if (!id) return null;

    if (!cache.has(id)) {
      cache.set(id, await this.slm.workingCalendar(id));
    }

    return cache.get(id) ?? null;
  }

  /** Recalcule sans propager l'échec : une échéance manquante ne bloque rien. */
  async refreshQuietly(ticketId: number): Promise<void> {
    try {
      await this.refresh(ticketId);
    } catch (error) {
      this.logger.error(
        `Recalcul des echeances impossible pour le ticket ${String(ticketId)} : ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
