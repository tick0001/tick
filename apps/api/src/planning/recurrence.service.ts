import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DEFAULT_LOCALE, type RecurringFilter, type RecurringTicket } from '@tick/contracts';
import type { UpsertRecurringTicket } from '@tick/contracts';
import { recurringTickets, sql } from '@tick/db';
import { Queue, Worker } from 'bullmq';
import { entityNames } from '../common/entity-names.js';
import { requireContext, runWithContext } from '../common/request-context.js';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { toIso, toIsoRequired, toText } from '../common/sql.js';
import { estEchue, firstOccurrence, nextOccurrence, type RecurrenceRule } from './recurrence.js';

export const RECURRENCE_QUEUE = 'tick.recurrence';

/**
 * Période de balayage.
 *
 * Cinq minutes : une récurrence se compte en jours, et la faire vérifier à la
 * minute coûterait une requête par minute pour un gain nul. L'avance de
 * création absorbe largement ce grain.
 */
const PERIODE_MS = 300_000;

/** Récurrences traitées par cycle, pour qu'un retard se rattrape par paliers. */
const PAR_CYCLE = 100;

interface DueRow extends Record<string, unknown> {
  id: number;
  entityId: number;
  entityPath: string;
  name: string;
  content: string;
  templateId: number;
  step: 'daily' | 'weekly' | 'monthly';
  interval: number;
  beginAt: unknown;
  endAt: unknown;
  createAheadMinutes: number;
  nextOccurrenceAt: unknown;
  createdById: number | null;
  timezone: string | null;
}

function asDate(valeur: unknown): Date {
  return valeur instanceof Date ? valeur : new Date(toText(valeur));
}

/**
 * Tickets récurrents.
 *
 * Le déclenchement est piloté par la base — `next_occurrence_at` — et non par
 * une minuterie en mémoire : un redémarrage ne perd aucune occurrence, et
 * plusieurs instances de l'API peuvent tourner sans se marcher dessus, la trace
 * dans `recurrence_runs` interdisant tout rejeu.
 *
 * C'est le même dispositif que l'escalade, pour la même raison : ce qui doit
 * survivre à un arrêt doit vivre dans la base, pas dans le processus.
 */
@Injectable()
export class RecurrenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurrenceService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly db: DatabaseService,
    private readonly tickets: TicketsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();

    if (!env.RUN_EVENT_WORKER) return;

    const connection = { url: env.REDIS_URL };

    this.queue = new Queue(RECURRENCE_QUEUE, {
      connection,
      defaultJobOptions: { removeOnComplete: 20, removeOnFail: 100 },
    });

    await this.queue.upsertJobScheduler(
      'balayage',
      { every: PERIODE_MS },
      { name: 'recurrence', data: {} },
    );

    this.worker = new Worker(
      RECURRENCE_QUEUE,
      async () => {
        await this.sweep();
      },
      { connection },
    );

    this.worker.on('error', (erreur) => {
      this.logger.error(`File de recurrence : ${erreur.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  // --- Configuration --------------------------------------------------------

  async list(filter: RecurringFilter): Promise<RecurringTicket[]> {
    const conditions = [sql`r.deleted_at IS NULL`];

    if (filter.active !== undefined) conditions.push(sql`r.is_active = ${filter.active}`);

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT r.id, r.name, r.content, r.is_active AS "isActive",
               r.template_id AS "templateId", g.name AS "templateName",
               r.entity_id AS "entityId",
               r.step::text AS step, r.interval,
               r.begin_at AS "beginAt", r.end_at AS "endAt",
               r.create_ahead_minutes AS "createAheadMinutes",
               r.next_occurrence_at AS "nextOccurrenceAt", r.last_run_at AS "lastRunAt",
               (SELECT count(*) FROM recurrence_runs x WHERE x.recurring_id = r.id) AS "runCount"
          FROM recurring_tickets r
          JOIN ticket_templates g ON g.id = r.template_id
         WHERE ${sql.join(conditions, sql` AND `)}
         ORDER BY r.name
      `);

      return resultat.rows;
    });

    // Le nom de l'entité se résout à part : joindre `entities` sous le
    // Row-Level Security ferait disparaître les lignes portées par un ancêtre.
    const noms = await entityNames(
      this.db,
      rows.map((row) => Number(row['entityId'])),
    );

    return rows.map((row) => {
      const entityId = Number(row['entityId']);

      return {
        id: Number(row['id']),
        name: toText(row['name']),
        content: toText(row['content']),
        isActive: Boolean(row['isActive']),
        templateId: Number(row['templateId']),
        templateName: toText(row['templateName']),
        entityId,
        entityName: noms.get(entityId) ?? '',
        step: row['step'] as RecurringTicket['step'],
        interval: Number(row['interval']),
        beginAt: toIsoRequired(row['beginAt']),
        endAt: toIso(row['endAt']),
        createAheadMinutes: Number(row['createAheadMinutes'] ?? 0),
        nextOccurrenceAt: toIso(row['nextOccurrenceAt']),
        lastRunAt: toIso(row['lastRunAt']),
        runCount: Number(row['runCount'] ?? 0),
      };
    });
  }

  async save(input: UpsertRecurringTicket, id?: number): Promise<RecurringTicket> {
    const context = requireContext();
    const debut = new Date(input.beginAt);
    const fin = input.endAt ? new Date(input.endAt) : null;

    if (Number.isNaN(debut.getTime())) throw new BadRequestException('Date de debut invalide.');
    if (fin && Number.isNaN(fin.getTime())) throw new BadRequestException('Date de fin invalide.');
    if (fin && fin.getTime() <= debut.getTime()) {
      throw new BadRequestException('La fin de la recurrence precede son debut.');
    }

    // Le gabarit est verifie ici, pas au moment de produire : une recurrence
    // dont le gabarit exige un champ qu'elle ne fournit pas echouerait toutes
    // les semaines, a trois heures du matin, sans que personne ne le voie.
    await this.assertTemplateSatisfiable(input);

    const fuseau = await this.timezoneOf(context.entityId);
    const regle: RecurrenceRule = {
      step: input.step,
      interval: input.interval,
      beginAt: debut,
      endAt: fin,
      timezone: fuseau,
    };

    // La prochaine occurrence est recalculée à chaque enregistrement : changer
    // la périodicité sans replanifier laisserait la règle tourner à l'ancien
    // rythme jusqu'à sa prochaine échéance, ce que personne ne comprendrait.
    const prochaine = input.isActive ? firstOccurrence(regle, new Date()) : null;

    const valeurs = {
      name: input.name,
      content: input.content,
      isActive: input.isActive,
      templateId: input.templateId,
      step: input.step,
      interval: input.interval,
      beginAt: debut,
      endAt: fin,
      createAheadMinutes: input.createAheadMinutes,
      nextOccurrenceAt: prochaine,
      updatedAt: new Date(),
    };

    const enregistre = await this.db.asUser(async (tx) => {
      if (id === undefined) {
        const [ligne] = await tx
          .insert(recurringTickets)
          .values({
            ...valeurs,
            entityId: context.entityId,
            // Recalculé par le déclencheur depuis `entity_id`.
            entityPath: 'temporaire',
            createdById: context.userId,
          })
          .returning({ id: recurringTickets.id });

        return ligne?.id;
      }

      const [ligne] = await tx
        .update(recurringTickets)
        .set(valeurs)
        .where(sql`${recurringTickets.id} = ${id} AND ${recurringTickets.deletedAt} IS NULL`)
        .returning({ id: recurringTickets.id });

      return ligne?.id;
    });

    if (enregistre === undefined) {
      throw new NotFoundException('Recurrence introuvable ou hors de votre perimetre.');
    }

    const toutes = await this.list({});
    const trouvee = toutes.find((valeur) => valeur.id === enregistre);

    if (!trouvee) throw new NotFoundException('Recurrence introuvable apres enregistrement.');

    return trouvee;
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      await tx
        .update(recurringTickets)
        .set({ deletedAt: new Date(), isActive: false, nextOccurrenceAt: null })
        .where(sql`${recurringTickets.id} = ${id}`);
    });
  }

  /**
   * Refuse une récurrence que son gabarit rendrait impossible à produire.
   *
   * Seuls le titre et la description viennent de la récurrence ; tout autre
   * champ rendu obligatoire par le gabarit devra venir de ses propres valeurs
   * préremplies, et à défaut la génération échouerait.
   */
  private async assertTemplateSatisfiable(input: UpsertRecurringTicket): Promise<void> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ field: string; kind: string; value: string | null }>(sql`
        SELECT field, kind::text AS kind, value
          FROM ticket_template_fields
         WHERE template_id = ${input.templateId}
      `);

      return resultat.rows;
    });

    const fournis = new Map<string, string>([
      ['name', input.name],
      ['content', input.content],
    ]);
    const preremplis = new Set(
      rows.filter((row) => row.kind === 'predefined' && row.value !== null).map((row) => row.field),
    );

    const manquants = rows
      .filter((row) => row.kind === 'mandatory')
      .map((row) => row.field)
      .filter((champ) => {
        if (preremplis.has(champ)) return false;

        const fourni = fournis.get(champ);

        return fourni === undefined || fourni.trim().length === 0;
      });

    if (manquants.length > 0) {
      throw new BadRequestException(
        `Le gabarit rend obligatoire un champ que la recurrence ne fournit pas : ${manquants.join(', ')}.`,
      );
    }
  }

  /**
   * Fuseau applicable aux occurrences.
   *
   * Celui du calendrier par défaut de l'entité, à défaut celui du serveur. Une
   * intervention prévue à 8 h doit rester à 8 h de part et d'autre d'un
   * changement d'heure, et c'est la seule information qui permette de le tenir.
   */
  private async timezoneOf(entityId: number): Promise<string> {
    const [row] = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ timezone: string | null }>(sql`
        SELECT c.timezone
          FROM entities e
          JOIN calendars c ON c.entity_path @> e.path
         WHERE e.id = ${entityId}
         ORDER BY nlevel(c.entity_path) DESC
         LIMIT 1
      `);

      return resultat.rows;
    });

    return row?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  // --- Génération -----------------------------------------------------------

  /**
   * Produit les occurrences échues.
   *
   * Lue en propriétaire : un balayage n'a pas de session, donc pas de périmètre
   * d'entités. Chaque occurrence est ensuite créée sous un contexte reconstitué
   * à partir de la récurrence elle-même, limité à son entité — le ticket produit
   * ne doit pas pouvoir naître ailleurs que là où la règle est déclarée.
   */
  async sweep(maintenant = new Date()): Promise<number> {
    const echues = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<DueRow>(sql`
        SELECT r.id, r.entity_id AS "entityId", r.entity_path::text AS "entityPath",
               r.name, r.content, r.template_id AS "templateId",
               r.step::text AS step, r.interval,
               r.begin_at AS "beginAt", r.end_at AS "endAt",
               r.create_ahead_minutes AS "createAheadMinutes",
               r.next_occurrence_at AS "nextOccurrenceAt",
               r.created_by_id AS "createdById",
               (SELECT c.timezone FROM calendars c
                 WHERE c.entity_path @> r.entity_path
                 ORDER BY nlevel(c.entity_path) DESC LIMIT 1) AS timezone
          FROM recurring_tickets r
         WHERE r.is_active AND r.deleted_at IS NULL
           AND r.next_occurrence_at IS NOT NULL
           AND r.next_occurrence_at - make_interval(mins => r.create_ahead_minutes) <= ${maintenant}
         ORDER BY r.next_occurrence_at
         LIMIT ${PAR_CYCLE}
      `);

      return resultat.rows;
    });

    let produits = 0;

    for (const echue of echues) {
      try {
        if (await this.generate(echue, maintenant)) produits += 1;
      } catch (error) {
        this.logger.error(`Recurrence ${String(echue.id)} en echec : ${String(error)}`);
      }
    }

    if (produits > 0) this.logger.log(`${String(produits)} ticket(s) recurrent(s) cree(s).`);

    return produits;
  }

  /**
   * Produit une occurrence, une seule fois.
   *
   * La trace est écrite **avant** le ticket, et son insertion sert de verrou :
   * si deux balayages concurrents attrapent la même récurrence, le second voit
   * le conflit et n'écrit rien. La planification suivante est posée dans tous
   * les cas — laisser `next_occurrence_at` dans le passé ferait retenter la même
   * occurrence à chaque cycle, indéfiniment.
   */
  private async generate(echue: DueRow, maintenant: Date): Promise<boolean> {
    const occurrence = asDate(echue.nextOccurrenceAt);
    const regle: RecurrenceRule = {
      step: echue.step,
      interval: echue.interval,
      beginAt: asDate(echue.beginAt),
      endAt: echue.endAt === null ? null : asDate(echue.endAt),
      timezone: echue.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    if (!estEchue(occurrence, echue.createAheadMinutes, maintenant)) return false;

    const reserve = await this.db.asOwner(async (tx) => {
      const trace = await tx.execute(sql`
        INSERT INTO recurrence_runs (recurring_id, occurrence_at)
        VALUES (${echue.id}, ${occurrence})
        ON CONFLICT DO NOTHING
      `);

      return (trace.rowCount ?? 0) > 0;
    });

    // Un autre balayage a déjà pris cette occurrence : il la replanifiera.
    if (!reserve) return false;

    let ticket;

    try {
      ticket = await this.dansLeContexte(echue, () =>
        this.tickets.create({
          name: echue.name,
          content: echue.content,
          type: 'incident',
          urgency: 3,
          impact: 3,
          templateId: echue.templateId,
          actors: [],
        }),
      );
    } catch (erreur) {
      // La réservation est rendue et l'échéance laissée en place : un ticket
      // récurrent manquant est un trou d'exploitation, et le cycle suivant doit
      // réessayer. Le journal nomme la cause à chaque tentative, ce qui est
      // exactement la pression qu'il faut pour aller la corriger.
      await this.db.asOwner(async (tx) => {
        await tx.execute(sql`
          DELETE FROM recurrence_runs
           WHERE recurring_id = ${echue.id} AND occurrence_at = ${occurrence}
             AND ticket_id IS NULL
        `);
      });

      throw erreur;
    }

    const suivante = nextOccurrence(regle, occurrence);

    await this.db.asOwner(async (tx) => {
      await tx.execute(sql`
        UPDATE recurrence_runs SET ticket_id = ${ticket.id}
         WHERE recurring_id = ${echue.id} AND occurrence_at = ${occurrence}
      `);
      await tx.execute(sql`
        UPDATE recurring_tickets
           SET next_occurrence_at = ${suivante},
               is_active = ${suivante !== null},
               last_run_at = ${maintenant}
         WHERE id = ${echue.id}
      `);
    });

    emitEvent('recurrence.generated', {
      recurringId: echue.id,
      ticketId: ticket.id,
      entityId: echue.entityId,
      occurrenceAt: occurrence.toISOString(),
    });

    return true;
  }

  /**
   * Exécute la création sous un contexte reconstitué.
   *
   * Le périmètre est **exactement** l'entité de la récurrence, jamais sa
   * descendance : une règle déclarée au siège ne doit pas pouvoir produire un
   * ticket dans une filiale.
   */
  private async dansLeContexte<T>(echue: DueRow, work: () => Promise<T>): Promise<T> {
    const profileId = await this.profileOf(echue.createdById, echue.entityPath);

    return runWithContext(
      {
        sessionId: 'recurrence',
        userId: echue.createdById ?? 0,
        profileId,
        entityId: echue.entityId,
        entityPath: echue.entityPath,
        includeSubEntities: false,
        locale: DEFAULT_LOCALE,
        profileInterface: 'standard',
        scope: { subtreePaths: [], exactPaths: [echue.entityPath] },
      },
      work,
    );
  }

  /**
   * Profil de l'auteur de la règle.
   *
   * Les droits appliqués sont les siens : la récurrence agit en son nom, et lui
   * prêter un profil plus large ferait produire des tickets qu'il n'aurait pas
   * pu créer lui-même.
   */
  private async profileOf(userId: number | null, entityPath: string): Promise<number> {
    if (userId === null) return 0;

    const [row] = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ profileId: number }>(sql`
        SELECT a.profile_id AS "profileId"
          FROM authorizations a
          JOIN entities e ON e.id = a.entity_id
         WHERE a.user_id = ${userId}
           AND (e.path = ${entityPath}::ltree
                OR (a.is_recursive AND e.path @> ${entityPath}::ltree))
         ORDER BY nlevel(e.path) DESC
         LIMIT 1
      `);

      return resultat.rows;
    });

    return row?.profileId ?? 0;
  }
}
