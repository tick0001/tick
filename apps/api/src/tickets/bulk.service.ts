import { Injectable, Logger } from '@nestjs/common';
import { itilStatusSchema, type BulkRequest, type BulkResult } from '@tick/contracts';
import { itilActors } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import { TicketsService } from './tickets.service.js';

/**
 * Actions massives sur une sélection de tickets.
 *
 * Chaque ticket passe par le service ordinaire, un par un, dans sa propre
 * transaction. Une mise à jour SQL de masse serait bien plus rapide et
 * contournerait tout ce qui fait la valeur d'une modification : transitions de
 * statut vérifiées, priorité recalculée, historique, règles, échéances,
 * notifications. Le gain de vitesse se paierait en incohérences silencieuses.
 *
 * Les échecs n'interrompent pas la série : sur quarante tickets, trois refus de
 * transition ne doivent pas annuler les trente-sept autres. Ils sont rendus un
 * par un — « 3 sur 40 ont échoué » n'aide personne à savoir lesquels reprendre.
 */
@Injectable()
export class BulkService {
  private readonly logger = new Logger(BulkService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tickets: TicketsService,
  ) {}

  async apply(requete: BulkRequest): Promise<BulkResult> {
    const echecs: { id: number; reason: string }[] = [];
    let appliques = 0;

    for (const id of requete.ids) {
      try {
        await this.applyOne(id, requete.operation);
        appliques += 1;
      } catch (error) {
        const raison = error instanceof Error ? error.message : String(error);

        echecs.push({ id, reason: raison });
      }
    }

    if (echecs.length > 0) {
      this.logger.warn(
        `Action massive « ${requete.operation.action} » : ${String(echecs.length)} echec(s).`,
      );
    }

    return { applied: appliques, failures: echecs };
  }

  private async applyOne(id: number, operation: BulkRequest['operation']): Promise<void> {
    switch (operation.action) {
      case 'setStatus':
        await this.tickets.update(id, { status: itilStatusSchema.parse(operation.value) });

        return;

      case 'setUrgency':
        // L'urgence, et la priorité suit : c'est la matrice de l'entité qui la
        // dérive, ici comme partout ailleurs.
        await this.tickets.update(id, { urgency: operation.value });

        return;

      case 'setCategory':
        await this.tickets.update(id, { categoryId: operation.value });

        return;

      case 'assignGroup':
        await this.addActor(id, 'group', operation.value);

        return;

      case 'assignUser':
        await this.addActor(id, 'user', operation.value);

        return;

      case 'delete':
        await this.tickets.softDelete(id);
    }
  }

  /**
   * Ajoute un intervenant sans effacer les autres.
   *
   * Remplacer les acteurs serait le comportement le plus simple et le plus
   * destructeur : une réaffectation massive retirerait au passage les
   * demandeurs, et personne ne s'en apercevrait avant la prochaine notification
   * qui n'atteint plus personne.
   */
  private async addActor(id: number, actorType: 'user' | 'group', actorId: number): Promise<void> {
    // Passe par le service pour la vérification de portée, puis écrit l'acteur.
    const acteurs = await this.tickets.actorsOf(id);

    await this.db.asUser(async (tx) => {
      await tx
        .insert(itilActors)
        .values({
          itilType: 'ticket' as const,
          itilId: id,
          role: 'assigned' as const,
          actorType,
          actorId,
          alternativeEmail: null,
        })
        .onConflictDoNothing();
    });

    // Un ticket qui reçoit son premier intervenant sort de « nouveau » : le
    // laisser tel quel ferait mentir toutes les statistiques de prise en compte.
    if (!acteurs.some((acteur) => acteur.role === 'assigned')) {
      const detail = await this.tickets.findById(id);

      if (detail.status === 'new') await this.tickets.update(id, { status: 'assigned' });
    }
  }
}
