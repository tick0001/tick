import { ForbiddenException, Injectable } from '@nestjs/common';
import type { ItilType } from '@tick/contracts';
import { groupMembers, sql, type SQL } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { ITIL_KINDS } from '../itil/itil-kinds.js';
import { RightsService, type RightScope } from '../auth/rights.service.js';

/**
 * Traduction d'une portée de droit en condition SQL.
 *
 * C'est ici que la seconde moitié du modèle de droits prend effet. Le Row-Level
 * Security borne déjà chaque requête au **périmètre de travail** ; la portée
 * du droit resserre encore, à l'intérieur de ce périmètre :
 *
 *   own       → les tickets dont je suis demandeur, ou que j'ai créés
 *   group     → ceux-là, plus ceux où l'un de mes groupes est acteur
 *   entity    → l'entité active seule, même si la session inclut la descendance
 *   recursive → l'entité active et sa descendance
 *   all       → tout le périmètre de travail
 *
 * Les deux mécanismes sont complémentaires et non redondants : le RLS protège
 * contre l'erreur de programmation et le SQL d'un plugin, la portée exprime une
 * règle métier — un technicien de niveau 1 ne modifie que les tickets de ses
 * groupes, même s'il voit ceux de son entité.
 */
@Injectable()
export class TicketScopeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rights: RightsService,
  ) {}

  /** Groupes de l'utilisateur courant. */
  private async groupIdsOf(userId: number): Promise<number[]> {
    const lignes = await this.db.asOwner((tx) =>
      tx
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(sql`${groupMembers.userId} = ${userId}`),
    );

    return lignes.map((ligne) => ligne.groupId);
  }

  /**
   * Condition à appliquer aux requêtes sur un objet ITIL, ou refus.
   *
   * L'absence de droit lève plutôt que de renvoyer une condition toujours
   * fausse : une liste vide et un accès refusé demandent des réactions
   * différentes de l'utilisateur, et les confondre transforme un problème
   * d'habilitation en apparente perte de données.
   *
   * `kind` choisit la table visée. Les trois objets partagent exactement la
   * même règle de portée : elle porte sur les acteurs et l'entité, que rien ne
   * distingue d'un type à l'autre.
   */
  async conditionFor(
    object: string,
    action: string,
    kind: ItilType = 'ticket',
  ): Promise<SQL | undefined> {
    const context = requireContext();
    const scope: RightScope | undefined = await this.rights.scopeFor(
      context.profileId,
      object,
      action,
    );

    if (!scope) {
      throw new ForbiddenException(`Droit manquant : ${object}:${action} pour le profil actif.`);
    }

    // Nom de table interpole en SQL brut : c'est une constante du code,
    // choisie par une cle du type `ItilType`, jamais une saisie.
    const table = sql.raw(ITIL_KINDS[kind].table);

    const estActeur = (roles: string[], types: string[], ids: number[]): SQL => sql`EXISTS (
      SELECT 1 FROM itil_actors a
       WHERE a.itil_type = ${kind}
         AND a.itil_id = ${table}.id
         AND a.role IN (${sql.join(
           roles.map((role) => sql`${role}`),
           sql`, `,
         )})
         AND a.actor_type IN (${sql.join(
           types.map((type) => sql`${type}`),
           sql`, `,
         )})
         AND a.actor_id IN (${sql.join(
           ids.map((id) => sql`${id}`),
           sql`, `,
         )})
    )`;

    switch (scope) {
      case 'own':
        return sql`(${estActeur(['requester', 'observer'], ['user'], [context.userId])}
                    OR ${table}.created_by_id = ${context.userId})`;

      case 'group': {
        const groupes = await this.groupIdsOf(context.userId);
        const propres = sql`(${estActeur(['requester', 'observer'], ['user'], [context.userId])}
                             OR ${table}.created_by_id = ${context.userId})`;

        if (groupes.length === 0) return propres;

        return sql`(${propres} OR ${estActeur(
          ['requester', 'observer', 'assigned'],
          ['group'],
          groupes,
        )})`;
      }

      case 'entity':
        // Volontairement l'entité seule : la portée `entity` ne suit pas la
        // descendance, même quand la session l'inclut.
        return sql`${table}.entity_id = ${context.entityId}`;

      case 'recursive':
        return sql`${table}.entity_path <@ ${context.entityPath}::ltree`;

      case 'all':
        // Rien à ajouter : le Row-Level Security borne déjà au périmètre.
        return undefined;
    }
  }

  /** Portée résolue, pour les décisions qui ne se traduisent pas en SQL. */
  async scopeOf(object: string, action: string): Promise<RightScope | undefined> {
    return this.rights.scopeFor(requireContext().profileId, object, action);
  }
}
