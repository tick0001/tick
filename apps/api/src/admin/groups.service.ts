import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Group, GroupMember, UpsertGroup, UpsertMember } from '@tick/contracts';
import { groupMembers, groups, sql } from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { toText } from '../tickets/ticket-sql.js';

/**
 * Groupes et appartenances.
 *
 * Le groupe est un objet de **configuration** : posé sur une entité avec le
 * drapeau récursif, il sert toute la descendance. C'est ce qui permet à une
 * équipe transverse d'intervenir sur les tickets de plusieurs filiales sans être
 * dupliquée dans chacune.
 */
@Injectable()
export class GroupsService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<Group[]> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT g.id, g.name, g.complete_name AS "completeName", g.comment,
               g.entity_id AS "entityId", g.is_recursive AS "isRecursive",
               g.is_requester AS "isRequester", g.is_assignable AS "isAssignable"
          FROM groups g
         WHERE g.deleted_at IS NULL
         ORDER BY g.complete_name
      `);

      return resultat.rows;
    });

    if (lignes.length === 0) return [];

    // Le nom de l'entité se résout côté propriétaire : joindre `entities` sous
    // le Row-Level Security ferait disparaître un groupe récursif porté par un
    // ancêtre, alors que sa propre politique le rend visible.
    const noms = await entityNames(
      this.db,
      lignes.map((ligne) => Number(ligne['entityId'])),
    );
    const membres = await this.membersByGroup(lignes.map((ligne) => Number(ligne['id'])));

    return lignes.map((ligne) => {
      const entityId = Number(ligne['entityId']);

      return {
        id: Number(ligne['id']),
        name: toText(ligne['name']),
        completeName: toText(ligne['completeName']),
        comment: (ligne['comment'] as string | null) ?? null,
        entityId,
        entityName: noms.get(entityId) ?? '',
        isRecursive: Boolean(ligne['isRecursive']),
        isRequester: Boolean(ligne['isRequester']),
        isAssignable: Boolean(ligne['isAssignable']),
        members: membres.get(Number(ligne['id'])) ?? [],
      };
    });
  }

  private async membersByGroup(ids: readonly number[]): Promise<Map<number, GroupMember[]>> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT m.group_id AS "groupId", m.user_id AS "userId",
               m.is_manager AS "isManager", m.is_dynamic AS "isDynamic",
               coalesce(
                 nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                 u.username::text
               ) AS "displayName"
          FROM group_members m
          JOIN users u ON u.id = m.user_id
         WHERE m.group_id IN (${sql.join(
           ids.map((id) => sql`${id}`),
           sql`, `,
         )})
         ORDER BY m.is_manager DESC, "displayName"
      `);

      return resultat.rows;
    });

    const parGroupe = new Map<number, GroupMember[]>();

    for (const ligne of lignes) {
      const id = Number(ligne['groupId']);
      const liste = parGroupe.get(id) ?? [];

      liste.push({
        userId: Number(ligne['userId']),
        displayName: toText(ligne['displayName']),
        isManager: Boolean(ligne['isManager']),
        isDynamic: Boolean(ligne['isDynamic']),
      });
      parGroupe.set(id, liste);
    }

    return parGroupe;
  }

  async save(input: UpsertGroup, id?: number): Promise<Group> {
    const context = requireContext();

    const cible = await this.db.asUser(async (tx) => {
      const valeurs = {
        name: input.name,
        completeName: input.name,
        comment: input.comment ?? null,
        isRecursive: input.isRecursive,
        isRequester: input.isRequester,
        isAssignable: input.isAssignable,
        updatedAt: new Date(),
      };

      if (id === undefined) {
        const [ligne] = await tx
          .insert(groups)
          .values({
            ...valeurs,
            entityId: context.entityId,
            // Recalculé par le déclencheur depuis `entity_id`.
            entityPath: 'temporaire',
          })
          .returning({ id: groups.id });

        return ligne?.id;
      }

      const [ligne] = await tx
        .update(groups)
        .set(valeurs)
        .where(sql`${groups.id} = ${id} AND ${groups.deletedAt} IS NULL`)
        .returning({ id: groups.id });

      return ligne?.id;
    });

    if (cible === undefined) throw new NotFoundException('Groupe introuvable ou hors perimetre.');

    const tous = await this.list();
    const trouve = tous.find((groupe) => groupe.id === cible);

    if (!trouve) throw new NotFoundException('Groupe introuvable apres enregistrement.');

    return trouve;
  }

  /**
   * Suppression logique.
   *
   * Logique et non définitive : un groupe peut être acteur de tickets clos, et
   * l'effacer rendrait leur historique incompréhensible — « attribué à » ne
   * désignerait plus personne.
   */
  async remove(id: number): Promise<void> {
    const supprimes = await this.db.asUser(async (tx) =>
      tx
        .update(groups)
        .set({ deletedAt: new Date() })
        .where(sql`${groups.id} = ${id} AND ${groups.deletedAt} IS NULL`)
        .returning({ id: groups.id }),
    );

    if (supprimes.length === 0) throw new NotFoundException('Groupe introuvable ou hors perimetre.');
  }

  async addMember(groupId: number, input: UpsertMember): Promise<Group> {
    await this.requireGroup(groupId);

    await this.db.asUser(async (tx) => {
      await tx
        .insert(groupMembers)
        .values({
          groupId,
          userId: input.userId,
          isManager: input.isManager,
          isDynamic: false,
        })
        .onConflictDoUpdate({
          target: [groupMembers.userId, groupMembers.groupId],
          // Une appartenance posée à la main cesse d'être dynamique : la
          // synchronisation d'annuaire ne doit plus la révoquer.
          set: { isManager: input.isManager, isDynamic: false },
        });
    });

    return this.requireGroup(groupId);
  }

  async removeMember(groupId: number, userId: number): Promise<Group> {
    await this.requireGroup(groupId);

    await this.db.asUser(async (tx) => {
      await tx.execute(
        sql`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}`,
      );
    });

    return this.requireGroup(groupId);
  }

  private async requireGroup(id: number): Promise<Group> {
    const tous = await this.list();
    const trouve = tous.find((groupe) => groupe.id === id);

    if (!trouve) throw new BadRequestException('Groupe introuvable ou hors perimetre.');

    return trouve;
  }
}
