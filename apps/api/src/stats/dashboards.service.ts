import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Dashboard, DashboardWidget, UpsertDashboard } from '@tick/contracts';
import { dashboards, dashboardWidgets, sql } from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { toText } from '../tickets/ticket-sql.js';
import { WidgetRegistry } from './widget-registry.service.js';

interface DashboardRow extends Record<string, unknown> {
  id: number;
  name: string;
  isPublic: boolean;
  isRecursive: boolean;
  entityId: number;
  ownerId: number | null;
  ownerName: string | null;
}

interface WidgetRow extends Record<string, unknown> {
  id: number;
  dashboardId: number;
  kind: string;
  title: string;
  position: number;
  width: number;
  config: unknown;
}

/**
 * Tableaux de bord composables.
 *
 * Un tableau est personnel par défaut. Le rendre public le partage avec tout le
 * périmètre : c'est une décision explicite, pas une conséquence de l'entité où
 * il a été créé. Un tableau personnel reste visible de son seul auteur, ce que
 * la requête tranche — le Row-Level Security, lui, ne connaît que l'entité.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly widgets: WidgetRegistry,
  ) {}

  async list(): Promise<Dashboard[]> {
    const context = requireContext();

    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<DashboardRow>(sql`
        SELECT d.id, d.name, d.is_public AS "isPublic", d.is_recursive AS "isRecursive",
               d.entity_id AS "entityId", d.owner_id AS "ownerId",
               coalesce(
                 nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                 u.username::text
               ) AS "ownerName"
          FROM dashboards d
          LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.is_public OR d.owner_id = ${context.userId}
         ORDER BY d.is_public, d.name
      `);

      return resultat.rows;
    });

    if (lignes.length === 0) return [];

    const widgets = await this.widgetsOf(lignes.map((ligne) => ligne.id));
    const noms = await entityNames(
      this.db,
      lignes.map((ligne) => Number(ligne.entityId)),
    );

    return lignes.map((ligne) => this.toDashboard(ligne, widgets, noms, context.userId));
  }

  async findById(id: number): Promise<Dashboard> {
    const tous = await this.list();
    const trouve = tous.find((tableau) => tableau.id === id);

    if (!trouve) throw new NotFoundException('Tableau de bord introuvable.');

    return trouve;
  }

  private toDashboard(
    ligne: DashboardRow,
    widgets: Map<number, DashboardWidget[]>,
    noms: Map<number, string>,
    userId: number,
  ): Dashboard {
    const entityId = Number(ligne.entityId);

    return {
      id: Number(ligne.id),
      name: toText(ligne.name),
      isPublic: Boolean(ligne.isPublic),
      isRecursive: Boolean(ligne.isRecursive),
      isMine: Number(ligne.ownerId) === userId,
      entityId,
      entityName: noms.get(entityId) ?? '',
      owner: ligne.ownerName,
      widgets: widgets.get(Number(ligne.id)) ?? [],
    };
  }

  /**
   * Widgets des tableaux demandés.
   *
   * Ceux dont la clé n'est plus déclarée — plugin désactivé — sont écartés de
   * l'affichage mais restent en base : réactiver le plugin les fait revenir, là
   * où les supprimer aurait perdu la composition du tableau.
   */
  private async widgetsOf(ids: readonly number[]): Promise<Map<number, DashboardWidget[]>> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<WidgetRow>(sql`
        SELECT id, dashboard_id AS "dashboardId", kind, title, position, width, config
          FROM dashboard_widgets
         WHERE dashboard_id IN (${sql.join(
           ids.map((id) => sql`${id}`),
           sql`, `,
         )})
         ORDER BY dashboard_id, position
      `);

      return resultat.rows;
    });

    const parTableau = new Map<number, DashboardWidget[]>();

    for (const row of rows) {
      if (!this.widgets.has(row.kind)) continue;

      const liste = parTableau.get(Number(row.dashboardId)) ?? [];

      liste.push({
        id: Number(row.id),
        kind: row.kind,
        title: toText(row.title),
        position: Number(row.position),
        width: Number(row.width),
        config: (row.config as Record<string, unknown> | null) ?? {},
      });
      parTableau.set(Number(row.dashboardId), liste);
    }

    return parTableau;
  }

  /**
   * Enregistre un tableau et sa composition.
   *
   * Les widgets sont remplacés en bloc plutôt que réconciliés un à un : leur
   * identité est leur position dans le tableau, et un différentiel n'apporterait
   * rien qu'une occasion de désynchroniser l'ordre.
   */
  async save(input: UpsertDashboard, id?: number): Promise<Dashboard> {
    const context = requireContext();

    for (const widget of input.widgets) {
      if (!this.widgets.has(widget.kind)) {
        throw new BadRequestException(`Widget inconnu : ${widget.kind}.`);
      }
    }

    const enregistre = await this.db.asUser(async (tx) => {
      const valeurs = {
        name: input.name,
        isPublic: input.isPublic,
        isRecursive: input.isRecursive,
        updatedAt: new Date(),
      };

      let cible = id;

      if (cible === undefined) {
        const [ligne] = await tx
          .insert(dashboards)
          .values({
            ...valeurs,
            entityId: context.entityId,
            // Recalculé par le déclencheur depuis `entity_id`.
            entityPath: 'temporaire',
            ownerId: context.userId,
          })
          .returning({ id: dashboards.id });

        cible = ligne?.id;
      } else {
        // Le propriétaire est le seul à pouvoir modifier son tableau, public ou
        // non : partager une vue n'est pas en confier la composition.
        const [ligne] = await tx
          .update(dashboards)
          .set(valeurs)
          .where(sql`${dashboards.id} = ${cible} AND ${dashboards.ownerId} = ${context.userId}`)
          .returning({ id: dashboards.id });

        cible = ligne?.id;
      }

      if (cible === undefined) return undefined;

      await tx.delete(dashboardWidgets).where(sql`${dashboardWidgets.dashboardId} = ${cible}`);

      if (input.widgets.length > 0) {
        await tx.insert(dashboardWidgets).values(
          input.widgets.map((widget, rang) => ({
            dashboardId: cible,
            kind: widget.kind,
            title: widget.title,
            position: rang,
            width: widget.width,
            config: widget.config,
          })),
        );
      }

      return cible;
    });

    if (enregistre === undefined) {
      throw new NotFoundException('Tableau de bord introuvable ou non modifiable.');
    }

    return this.findById(enregistre);
  }

  async remove(id: number): Promise<void> {
    const context = requireContext();

    const supprimes = await this.db.asUser(async (tx) =>
      tx
        .delete(dashboards)
        .where(sql`${dashboards.id} = ${id} AND ${dashboards.ownerId} = ${context.userId}`)
        .returning({ id: dashboards.id }),
    );

    if (supprimes.length === 0) {
      throw new NotFoundException('Tableau de bord introuvable ou non modifiable.');
    }
  }
}
