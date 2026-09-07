import { Injectable } from '@nestjs/common';
import { sql } from '@tick/db';
import type { ItilCategory, ItilCategoryFilter } from '@tick/contracts';
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
    const applicable = filtre.type ? sql.raw(`AND (${APPLICABILITE[filtre.type] ?? 'TRUE'})`) : sql``;

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
}
