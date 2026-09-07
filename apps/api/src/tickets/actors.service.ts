import { BadRequestException, Injectable } from '@nestjs/common';
import type { ItilType, TicketActor, TicketActorInput } from '@tick/contracts';
import { itilActors, sql, type Transaction } from '@tick/db';
import { nomAffiche } from '../common/sql.js';
import { DatabaseService } from '../database/database.service.js';
import { HistoryService } from './history.service.js';

/**
 * Les acteurs d'un objet ITIL, quel qu'il soit.
 *
 * `itil_actors` est une table unique pour les trois objets : le ticket, le
 * problème et le changement y désignent leurs demandeurs, observateurs et
 * attributaires de la même façon. Le code qui la lisait, lui, existait en deux
 * exemplaires — un dans `TicketsService`, un dans `ItilObjectsService` — dont la
 * seule différence tenait au `itil_type` recherché. Cent dix lignes, la même
 * jointure triple recopiée, et la garantie qu'un jour l'un dirait « (inconnu) »
 * là où l'autre dirait autre chose.
 *
 * Le service vit dans `tickets/` avec les autres briques du socle commun —
 * historique, priorité, portée, chronologie — parce que `ItilModule` importe
 * `TicketsModule`, et non l'inverse.
 */
@Injectable()
export class ActorsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly history: HistoryService,
  ) {}

  /**
   * Acteurs de l'objet, tous rôles et toutes natures confondus.
   *
   * Les jointures sont externes à dessein : un acteur devenu invisible produit
   * un libellé nul, remplacé par « (inconnu) », plutôt que de faire disparaître
   * la ligne — on saurait alors qu'il manque quelqu'un sans savoir qui.
   */
  async listOf(type: ItilType, id: number): Promise<TicketActor[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketActor & Record<string, unknown>>(sql`
        SELECT
          acteur.role, acteur.actor_type AS "actorType", acteur.actor_id AS "actorId",
          acteur.alternative_email AS "alternativeEmail",
          coalesce(
            CASE acteur.actor_type
              WHEN 'user' THEN ${nomAffiche()}
              WHEN 'group' THEN g.name
              WHEN 'supplier' THEN f.name
            END,
            '(inconnu)'
          ) AS "label"
        FROM itil_actors acteur
        LEFT JOIN users u ON acteur.actor_type = 'user' AND u.id = acteur.actor_id
        LEFT JOIN groups g ON acteur.actor_type = 'group' AND g.id = acteur.actor_id
        LEFT JOIN suppliers f ON acteur.actor_type = 'supplier' AND f.id = acteur.actor_id
        WHERE acteur.itil_type = ${type} AND acteur.itil_id = ${id}
        ORDER BY acteur.role, "label"
      `);

      return resultat.rows;
    });
  }

  /** Écrit des acteurs sans effacer les existants. */
  async write(
    tx: Transaction,
    type: ItilType,
    id: number,
    acteurs: readonly TicketActorInput[],
  ): Promise<void> {
    if (acteurs.length === 0) return;

    await tx
      .insert(itilActors)
      .values(
        acteurs.map((acteur) => ({
          itilType: type,
          itilId: id,
          role: acteur.role,
          actorType: acteur.actorType,
          actorId: acteur.actorId,
          alternativeEmail: acteur.alternativeEmail ?? null,
        })),
      )
      .onConflictDoNothing();
  }

  /**
   * Remplace la distribution entière, et la consigne.
   *
   * Effacer puis réécrire plutôt que rapprocher ligne à ligne : la liste
   * envoyée est la vérité, et un rapprochement laisserait passer un retrait
   * silencieux le jour où une nature d'acteur s'ajoute.
   */
  async replace(
    tx: Transaction,
    cible: { type: ItilType; id: number; entityId: number },
    acteurs: readonly TicketActorInput[],
  ): Promise<void> {
    await tx
      .delete(itilActors)
      .where(sql`${itilActors.itilType} = ${cible.type} AND ${itilActors.itilId} = ${cible.id}`);

    await this.write(tx, cible.type, cible.id, acteurs);

    await this.history.recordAction(
      tx,
      cible,
      'acteurs',
      acteurs
        .map((acteur) => `${acteur.role}:${acteur.actorType}#${String(acteur.actorId)}`)
        .join(', '),
    );
  }

  /**
   * Un objet sans demandeur n'a plus personne à qui répondre.
   *
   * La vérification est ici et non dans le contrat : Zod valide la forme d'une
   * liste d'acteurs, pas le fait qu'elle laisse l'objet utilisable.
   */
  assertDemandeur(acteurs: readonly TicketActorInput[], nom: string): void {
    if (!acteurs.some((acteur) => acteur.role === 'requester')) {
      throw new BadRequestException(`Un ${nom} doit conserver au moins un demandeur.`);
    }
  }
}
