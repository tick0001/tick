import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { itilCategories, sql } from '@tick/db';
import type {
  ItilCategory,
  ItilCategoryDetail,
  ItilCategoryFilter,
  UpsertItilCategory,
} from '@tick/contracts';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * Référentiels de saisie, en lecture.
 *
 * Ils n'ont pas de garde de droit : choisir une catégorie fait partie de
 * l'ouverture d'un ticket, geste que tout compte authentifié peut accomplir.
 * Le périmètre, lui, reste tenu par le Row-Level Security — un référentiel
 * défini dans une autre branche ne remonte pas, sans qu'aucune condition ne
 * soit écrite ici.
 */

/** Colonne d'applicabilité, par type d'objet ITIL. */
const APPLICABILITE: Record<string, string> = {
  ticket: 'for_incident OR for_request',
  problem: 'for_problem',
  change: 'for_change',
};

@Injectable()
export class ReferentialsService {
  constructor(private readonly db: DatabaseService) {}

  async itilCategories(filtre: ItilCategoryFilter): Promise<ItilCategory[]> {
    const context = requireContext();

    /**
     * Le demandeur ne voit que ce qui lui est destiné.
     *
     * `is_helpdesk_visible` distingue les catégories offertes au guichet de
     * celles qui servent au classement interne. La décision est prise ici, et
     * non d'après un paramètre de la requête : un client peut demander ce qu'il
     * veut, et une catégorie interne n'a rien à faire dans la liste d'un
     * demandeur.
     */
    const guichet =
      context.profileInterface === 'self_service' ? sql`AND is_helpdesk_visible` : sql``;

    // Une categorie « non selectionnable » reste dans l'arbre pour porter ses
    // filles : c'est un intitule de regroupement, pas un classement possible.
    const applicable = filtre.type
      ? sql.raw(`AND (${APPLICABILITE[filtre.type] ?? 'TRUE'})`)
      : sql``;

    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<ItilCategory>(sql`
        SELECT id,
               name,
               complete_name AS "completeName",
               parent_id AS "parentId",
               nlevel(path) - 1 AS level
          FROM itil_categories
         WHERE deleted_at IS NULL
           ${guichet}
           ${applicable}
         ORDER BY complete_name
      `);

      return resultat.rows;
    });
  }

  /**
   * Catégories telles que l'écran de configuration les liste.
   *
   * Sans filtre de guichet ni d'applicabilité : on configure aussi ce qu'on ne
   * propose pas. Le nombre de filles accompagne chaque ligne parce que c'est
   * lui qui décide si la suppression est possible, et le calculer à la demande
   * ferait une requête par ligne.
   */
  async itilCategoriesDetail(): Promise<ItilCategoryDetail[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<ItilCategoryDetail>(sql`
        SELECT c.id,
               c.name,
               c.complete_name AS "completeName",
               c.parent_id AS "parentId",
               nlevel(c.path) - 1 AS level,
               c.comment,
               c.is_helpdesk_visible AS "isHelpdeskVisible",
               c.for_incident AS "forIncident",
               c.for_request AS "forRequest",
               c.for_problem AS "forProblem",
               c.for_change AS "forChange",
               c.is_recursive AS "isRecursive",
               c.entity_id AS "entityId",
               e.name AS "entityName",
               (SELECT count(*)::int FROM itil_categories f
                 WHERE f.parent_id = c.id AND f.deleted_at IS NULL) AS "childCount"
          FROM itil_categories c
          JOIN entities e ON e.id = c.entity_id
         WHERE c.deleted_at IS NULL
         ORDER BY c.complete_name
      `);

      return resultat.rows;
    });
  }

  async saveItilCategory(input: UpsertItilCategory, id?: number): Promise<ItilCategoryDetail> {
    const context = requireContext();

    this.assertApplicable(input);

    if (id !== undefined) await this.assertPasSonPropreAncetre(id, input.parentId ?? null);

    const cible = await this.db.asUser(async (tx) => {
      const valeurs = {
        parentId: input.parentId ?? null,
        name: input.name,
        comment: input.comment ?? null,
        isHelpdeskVisible: input.isHelpdeskVisible,
        forIncident: input.forIncident,
        forRequest: input.forRequest,
        forProblem: input.forProblem,
        forChange: input.forChange,
        isRecursive: input.isRecursive,
      };

      if (id !== undefined) {
        const resultat = await tx
          .update(itilCategories)
          .set({ ...valeurs, updatedAt: new Date() })
          .where(sql`${itilCategories.id} = ${id} AND ${itilCategories.deletedAt} IS NULL`);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Categorie introuvable dans ce perimetre.');
        }

        return id;
      }

      const [ligne] = await tx
        .insert(itilCategories)
        .values({
          ...valeurs,
          entityId: context.entityId,
          // Le declencheur remplace ces marqueurs par les valeurs reelles : le
          // chemin et le nom complet se deduisent du parent, jamais de
          // l'appelant.
          entityPath: 'temporaire',
          path: 'temporaire',
          completeName: input.name,
        })
        .returning({ id: itilCategories.id });

      if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');

      return ligne.id;
    });

    const toutes = await this.itilCategoriesDetail();
    const trouvee = toutes.find((categorie) => categorie.id === cible);

    if (!trouvee) throw new NotFoundException('Categorie introuvable dans ce perimetre.');

    return trouvee;
  }

  /**
   * Suppression logique.
   *
   * Refusée tant que la catégorie porte des filles : les effacer en cascade
   * emporterait un pan du référentiel sur un seul clic, et les laisser
   * orphelines produirait des lignes rattachées à un parent invisible. Les
   * tickets déjà classés, eux, gardent leur référence — c'est tout l'intérêt
   * de ne pas supprimer réellement.
   */
  async removeItilCategory(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const filles = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM itil_categories
         WHERE parent_id = ${id} AND deleted_at IS NULL
      `);

      if ((filles.rows[0]?.n ?? 0) > 0) {
        throw new BadRequestException(
          'Cette categorie a des sous-categories : retirez-les d abord.',
        );
      }

      const resultat = await tx
        .update(itilCategories)
        .set({ deletedAt: new Date() })
        .where(sql`${itilCategories.id} = ${id} AND ${itilCategories.deletedAt} IS NULL`);

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Categorie introuvable dans ce perimetre.');
      }
    });
  }

  /** Une categorie qui ne s'applique a rien ne peut jamais etre choisie. */
  private assertApplicable(input: UpsertItilCategory): void {
    if (!input.forIncident && !input.forRequest && !input.forProblem && !input.forChange) {
      throw new BadRequestException('Une categorie doit s appliquer a au moins un type d objet.');
    }
  }

  /**
   * Un deplacement ne doit pas refermer l'arbre sur lui-meme.
   *
   * Rattacher une categorie a l'une de ses propres filles produirait un cycle :
   * le declencheur qui recalcule les chemins tournerait indefiniment, et la
   * transaction finirait par tomber sur une erreur incomprehensible.
   */
  private async assertPasSonPropreAncetre(id: number, parentId: number | null): Promise<void> {
    if (parentId === null) return;
    if (parentId === id) throw new BadRequestException('Une categorie ne peut pas se contenir.');

    const cycle = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n
          FROM itil_categories parent, itil_categories courante
         WHERE parent.id = ${parentId}
           AND courante.id = ${id}
           AND parent.path <@ courante.path
      `);

      return resultat.rows[0]?.n ?? 0;
    });

    if (cycle > 0) {
      throw new BadRequestException('Une categorie ne peut pas etre rattachee a sa descendance.');
    }
  }
}
