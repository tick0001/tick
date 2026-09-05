import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql, type EntityScope } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';

export interface AuthorizedEntity extends Record<string, unknown> {
  entityId: number;
  entityPath: string;
  name: string;
  completeName: string;
  profileId: number;
  profileName: string;
  profileInterface: 'standard' | 'self_service';
  isRecursive: boolean;
}

export interface WorkingScope {
  entityId: number;
  entityPath: string;
  scope: EntityScope;
  includeSubEntities: boolean;
}

/**
 * Resolution du perimetre d'entites.
 *
 * Deux notions distinctes, souvent confondues :
 *
 *  - le perimetre *habilite* : tout ce a quoi l'utilisateur pourrait acceder,
 *    tous profils et toutes branches confondus. Il alimente le selecteur
 *    d'entite ;
 *  - le perimetre *de travail* : l'entite active et, si l'utilisateur l'a
 *    choisi et qu'une habilitation recursive le permet, sa descendance. C'est
 *    lui, et lui seul, qui est injecte dans le Row-Level Security.
 *
 * Ces requetes passent par le role proprietaire : elles precedent l'existence
 * du contexte qu'elles servent justement a construire.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly db: DatabaseService) {}

  /** Entites accessibles a l'utilisateur, habilitations recursives developpees. */
  async authorizedEntities(userId: number): Promise<AuthorizedEntity[]> {
    return this.db.asOwner(async (tx) => {
      const result = await tx.execute<AuthorizedEntity>(sql`
        SELECT DISTINCT
          e.id            AS "entityId",
          e.path::text    AS "entityPath",
          e.name          AS "name",
          e.complete_name AS "completeName",
          p.id            AS "profileId",
          p.name          AS "profileName",
          p.interface     AS "profileInterface",
          a.is_recursive  AS "isRecursive"
        FROM authorizations a
        JOIN entities racine ON racine.id = a.entity_id
        JOIN entities e
          ON e.path = racine.path
          OR (a.is_recursive AND e.path <@ racine.path)
        JOIN profiles p ON p.id = a.profile_id
        WHERE a.user_id = ${userId}
          AND e.deleted_at IS NULL
          AND racine.deleted_at IS NULL
        -- Tri sur les alias : avec DISTINCT, PostgreSQL exige que les
        -- expressions de tri figurent dans la liste de selection, or le chemin
        -- y est transtype en texte.
        ORDER BY "entityPath", "profileName"
      `);

      return result.rows;
    });
  }

  /**
   * Perimetre de travail effectif, ou refus.
   *
   * `includeSubEntities` n'est honore que si une habilitation recursive couvre
   * reellement l'entite active : demander la descendance ne suffit pas a y
   * avoir droit.
   */
  async workingScope(
    userId: number,
    entityId: number,
    profileId: number,
    includeSubEntities: boolean,
  ): Promise<WorkingScope> {
    return this.db.asOwner(async (tx) => {
      const result = await tx.execute<
        {
          entityPath: string;
          canRecurse: boolean;
        } & Record<string, unknown>
      >(sql`
        SELECT
          cible.path::text AS "entityPath",
          bool_or(a.is_recursive) AS "canRecurse"
        FROM entities cible
        JOIN entities racine ON racine.path @> cible.path
        JOIN authorizations a
          ON a.entity_id = racine.id
         AND a.user_id = ${userId}
         AND a.profile_id = ${profileId}
         AND (racine.id = cible.id OR a.is_recursive)
        WHERE cible.id = ${entityId}
          AND cible.deleted_at IS NULL
        GROUP BY cible.path
      `);

      const row = result.rows[0];

      if (!row) {
        throw new ForbiddenException('Aucune habilitation ne couvre cette entite avec ce profil.');
      }

      const recursive = includeSubEntities && row.canRecurse;

      return {
        entityId,
        entityPath: row.entityPath,
        includeSubEntities: recursive,
        scope: recursive
          ? { subtreePaths: [row.entityPath], exactPaths: [] }
          : { subtreePaths: [], exactPaths: [row.entityPath] },
      };
    });
  }
}
