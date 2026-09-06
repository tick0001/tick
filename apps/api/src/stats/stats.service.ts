import { Injectable } from '@nestjs/common';
import type {
  StatDimension,
  StatsBucket,
  StatsFilter,
  StatsReport,
  StatsSummary,
  StatsTrendPoint,
} from '@tick/contracts';
import { sql, type SQL } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import { toText } from '../tickets/ticket-sql.js';

/**
 * Dimensions d'analyse, vers leur clé et leur libellé SQL.
 *
 * Table fermée, indexée par un type d'union : c'est ce qui permet de composer
 * l'agrégation sans jamais interpoler un nom de colonne venu de la requête. Le
 * libellé sort de la base plutôt que d'un dictionnaire côté interface, parce
 * qu'une catégorie ou un groupe n'a pas de traduction — il a un nom.
 */
const DIMENSIONS: Record<StatDimension, { key: SQL; label: SQL; join: SQL }> = {
  entity: {
    key: sql`t.entity_id::text`,
    label: sql`coalesce(e.complete_name, '(inconnue)')`,
    join: sql`LEFT JOIN entities e ON e.id = t.entity_id`,
  },
  category: {
    key: sql`coalesce(t.category_id::text, '')`,
    label: sql`coalesce(c.complete_name, '(sans categorie)')`,
    join: sql`LEFT JOIN itil_categories c ON c.id = t.category_id`,
  },
  technician: {
    key: sql`coalesce(a.actor_id::text, '')`,
    label: sql`coalesce(
      nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
      u.username::text,
      '(non attribue)'
    )`,
    join: sql`
      LEFT JOIN itil_actors a ON a.itil_type = 'ticket' AND a.itil_id = t.id
                             AND a.role = 'assigned' AND a.actor_type = 'user'
      LEFT JOIN users u ON u.id = a.actor_id`,
  },
  group: {
    key: sql`coalesce(a.actor_id::text, '')`,
    label: sql`coalesce(g.name, '(sans groupe)')`,
    join: sql`
      LEFT JOIN itil_actors a ON a.itil_type = 'ticket' AND a.itil_id = t.id
                             AND a.role = 'assigned' AND a.actor_type = 'group'
      LEFT JOIN groups g ON g.id = a.actor_id`,
  },
  priority: { key: sql`t.priority::text`, label: sql`t.priority::text`, join: sql`` },
  source: {
    key: sql`coalesce(t.request_source_id::text, '')`,
    label: sql`coalesce(s.name, '(sans source)')`,
    join: sql`LEFT JOIN request_sources s ON s.id = t.request_source_id`,
  },
  status: { key: sql`t.status::text`, label: sql`t.status::text`, join: sql`` },
  type: { key: sql`t.type::text`, label: sql`t.type::text`, join: sql`` },
};

/** Jours couverts par la courbe d'activité. */
const JOURS_TENDANCE = 30;

interface SummaryRow extends Record<string, unknown> {
  opened: unknown;
  solved: unknown;
  closed: unknown;
  pending: unknown;
  averageTakeIntoAccount: unknown;
  averageSolve: unknown;
  slaHonored: unknown;
  slaTotal: unknown;
  satisfaction: unknown;
  satisfactionCount: unknown;
}

function entier(valeur: unknown): number {
  const nombre = Number(valeur ?? 0);

  return Number.isFinite(nombre) ? Math.trunc(nombre) : 0;
}

function decimal(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined) return null;

  const nombre = Number(valeur);

  return Number.isFinite(nombre) ? nombre : null;
}

/**
 * Statistiques d'exploitation.
 *
 * Toutes les requêtes passent par la portée du droit de lecture sur les
 * tickets : un indicateur agrégé reste une lecture, et il ne doit pas révéler
 * ce que la liste refuse de montrer. C'est le piège classique du module de
 * statistiques — on y compte volontiers « tous les tickets » en oubliant que
 * l'agrégat est lui aussi une divulgation.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly scopes: TicketScopeService,
  ) {}

  /**
   * Périmètre commun à toutes les agrégations : portée, corbeille et fenêtre.
   *
   * L'alias est demandé à la source plutôt que réécrit après coup : les
   * agrégations joignent `tickets` sous un nom court, et la portée doit
   * s'exprimer sur ce nom-là.
   */
  private async conditions(filter: StatsFilter, alias = 't'): Promise<SQL[]> {
    const condition = await this.scopes.conditionFor('ticket', 'read', 'ticket', alias);
    const table = sql.raw(alias);
    const conditions: SQL[] = [sql`${table}.deleted_at IS NULL`];

    if (condition) conditions.push(condition);
    if (filter.from) conditions.push(sql`${table}.date_opened >= ${new Date(filter.from)}`);
    if (filter.to) conditions.push(sql`${table}.date_opened <= ${new Date(filter.to)}`);

    return conditions;
  }

  async report(filter: StatsFilter): Promise<StatsReport> {
    const conditions = await this.conditions(filter);

    return {
      summary: await this.summary(conditions),
      dimension: filter.dimension,
      buckets: await this.buckets(conditions, filter.dimension),
    };
  }

  private async summary(conditions: SQL[]): Promise<StatsSummary> {
    const etendue = sql.join(conditions, sql` AND `);

    const [row] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<SummaryRow>(sql`
        SELECT
          count(*) AS opened,
          count(*) FILTER (WHERE t.date_solved IS NOT NULL) AS solved,
          count(*) FILTER (WHERE t.date_closed IS NOT NULL) AS closed,
          count(*) FILTER (WHERE t.status <> 'closed') AS pending,
          avg(t.take_into_account_delay) AS "averageTakeIntoAccount",
          avg(t.solve_delay) AS "averageSolve",
          -- L'engagement n'est compté que là où il existe et où l'échéance est
          -- passée ou tenue : un ticket sans SLA ne peut ni l'honorer ni le
          -- manquer, et l'inclure ferait mécaniquement monter le taux.
          count(*) FILTER (
            WHERE t.date_due IS NOT NULL AND t.date_solved IS NOT NULL
              AND t.date_solved <= t.date_due
          ) AS "slaHonored",
          count(*) FILTER (
            WHERE t.date_due IS NOT NULL
              AND (t.date_solved IS NOT NULL OR t.date_due < now())
          ) AS "slaTotal",
          (SELECT avg(x.rating) FROM satisfactions x
            WHERE x.rating IS NOT NULL
              AND x.ticket_id IN (SELECT t.id FROM tickets t WHERE ${etendue})) AS satisfaction,
          (SELECT count(*) FROM satisfactions x
            WHERE x.rating IS NOT NULL
              AND x.ticket_id IN (SELECT t.id FROM tickets t WHERE ${etendue})) AS "satisfactionCount"
        FROM tickets t
        WHERE ${etendue}
      `);

      return resultat.rows;
    });

    const tenus = entier(row?.slaHonored);
    const total = entier(row?.slaTotal);

    return {
      opened: entier(row?.opened),
      solved: entier(row?.solved),
      closed: entier(row?.closed),
      pending: entier(row?.pending),
      averageTakeIntoAccount: decimal(row?.averageTakeIntoAccount),
      averageSolve: decimal(row?.averageSolve),
      slaCompliance: total > 0 ? tenus / total : null,
      satisfaction: decimal(row?.satisfaction),
      satisfactionCount: entier(row?.satisfactionCount),
    };
  }

  private async buckets(conditions: SQL[], dimension: StatDimension): Promise<StatsBucket[]> {
    const definition = DIMENSIONS[dimension];

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT ${definition.key} AS key, ${definition.label} AS label,
               count(*) AS opened,
               count(*) FILTER (WHERE t.date_solved IS NOT NULL) AS solved,
               count(*) FILTER (WHERE t.date_closed IS NOT NULL) AS closed,
               avg(t.solve_delay) AS "averageSolve"
          FROM tickets t
          ${definition.join}
         WHERE ${sql.join(conditions, sql` AND `)}
         GROUP BY 1, 2
         ORDER BY 3 DESC, 2
         LIMIT 50
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({
      key: toText(row['key']),
      label: toText(row['label']),
      opened: entier(row['opened']),
      solved: entier(row['solved']),
      closed: entier(row['closed']),
      averageSolve: decimal(row['averageSolve']),
    }));
  }

  /**
   * Courbe d'activité, jour par jour.
   *
   * La série de dates vient de `generate_series` et non des tickets : sans
   * elle, un jour sans ticket disparaîtrait, et la courbe relierait deux points
   * distants en laissant croire à une activité continue.
   */
  async trend(filter: StatsFilter): Promise<StatsTrendPoint[]> {
    const conditions = await this.conditions(filter);
    const fin = filter.to ? new Date(filter.to) : new Date();
    const debut = filter.from
      ? new Date(filter.from)
      : new Date(fin.getTime() - JOURS_TENDANCE * 86_400_000);

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        WITH jours AS (
          SELECT generate_series(
            date_trunc('day', ${debut}::timestamptz),
            date_trunc('day', ${fin}::timestamptz),
            interval '1 day'
          ) AS jour
        )
        SELECT to_char(j.jour, 'YYYY-MM-DD') AS day,
               count(t.id) FILTER (WHERE date_trunc('day', t.date_opened) = j.jour) AS opened,
               count(t.id) FILTER (WHERE date_trunc('day', t.date_closed) = j.jour) AS closed
          FROM jours j
          LEFT JOIN tickets t
            ON (date_trunc('day', t.date_opened) = j.jour
                OR date_trunc('day', t.date_closed) = j.jour)
           AND ${sql.join(conditions, sql` AND `)}
         GROUP BY j.jour
         ORDER BY j.jour
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({
      day: toText(row['day']),
      opened: entier(row['opened']),
      closed: entier(row['closed']),
    }));
  }
}
