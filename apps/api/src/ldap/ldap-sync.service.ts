import { Injectable, Logger } from '@nestjs/common';
import { and, authorizations, eq, ldapDirectories, ldapGroupMappings, users } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import type { LdapDirectory, LdapProfile } from './ldap.service.js';

export interface SyncResult {
  userId: number;
  /** Habilitations dynamiques posees ou conservees. */
  granted: number;
  /** Habilitations dynamiques retirees parce que le groupe a ete quitte. */
  revoked: number;
}

function keyOf(a: { profileId: number; entityId: number }): string {
  return `${String(a.profileId)}:${String(a.entityId)}`;
}

/**
 * Synchronisation d'un compte d'annuaire vers le modele local.
 *
 * Deux responsabilites, volontairement separees de la decision :
 *
 *  - reporter l'identite (compte local cree ou mis a jour) ;
 *  - reconcilier les habilitations **dynamiques** avec l'appartenance aux
 *    groupes constatee dans l'annuaire.
 *
 * La source de decision est aujourd'hui une simple table de correspondance. Le
 * moteur de regles generique du jalon J4 la remplacera, mais la reconciliation
 * ci-dessous ne changera pas : c'est elle qui garantit qu'une habilitation
 * saisie a la main survit a une synchronisation, et qu'une habilitation heritee
 * d'un groupe disparait avec lui.
 */
@Injectable()
export class LdapSyncService {
  private readonly logger = new Logger(LdapSyncService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Cree ou met a jour le compte local a partir du profil d'annuaire. */
  async upsertUser(directory: LdapDirectory, profile: LdapProfile): Promise<number> {
    return this.db.asOwner(async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.username, profile.login));

      if (existing) {
        await tx
          .update(users)
          .set({
            email: profile.email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            authSource: 'ldap',
            ldapDn: profile.dn,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id));

        return existing.id;
      }

      const [created] = await tx
        .insert(users)
        .values({
          username: profile.login,
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          authSource: 'ldap',
          ldapDn: profile.dn,
          // Aucun condensat local : l'annuaire reste seul juge du mot de passe.
          passwordHash: null,
        })
        .returning({ id: users.id });

      if (!created) throw new Error(`Creation du compte ${profile.login} impossible.`);

      await tx
        .update(ldapDirectories)
        .set({ lastSyncAt: new Date() })
        .where(eq(ldapDirectories.id, directory.id));

      return created.id;
    });
  }

  /**
   * Reconcilie les habilitations dynamiques avec l'appartenance aux groupes.
   *
   * Les habilitations saisies a la main (`is_dynamic = false`) ne sont ni lues
   * ni touchees : un administrateur qui accorde un acces exceptionnel ne doit
   * pas le voir disparaitre a la prochaine synchronisation.
   */
  async applyDynamicAuthorizations(
    directoryId: number,
    userId: number,
    groupDns: readonly string[],
  ): Promise<SyncResult> {
    const normalized = new Set(groupDns.map((dn) => dn.trim().toLowerCase()));

    return this.db.asOwner(async (tx) => {
      const mappings = await tx
        .select()
        .from(ldapGroupMappings)
        .where(eq(ldapGroupMappings.directoryId, directoryId));

      // Les noms distinctifs sont insensibles a la casse et souvent espaces de
      // maniere variable selon l'annuaire.
      const attendues = mappings.filter((mapping) =>
        normalized.has(mapping.groupDn.trim().toLowerCase()),
      );
      const attenduesParCle = new Map(attendues.map((mapping) => [keyOf(mapping), mapping]));

      const existantes = await tx
        .select()
        .from(authorizations)
        .where(and(eq(authorizations.userId, userId), eq(authorizations.isDynamic, true)));

      let revoked = 0;
      for (const existante of existantes) {
        if (attenduesParCle.has(keyOf(existante))) continue;

        await tx
          .delete(authorizations)
          .where(
            and(
              eq(authorizations.userId, userId),
              eq(authorizations.profileId, existante.profileId),
              eq(authorizations.entityId, existante.entityId),
              eq(authorizations.isDynamic, true),
            ),
          );
        revoked += 1;
      }

      for (const attendue of attendues) {
        await tx
          .insert(authorizations)
          .values({
            userId,
            profileId: attendue.profileId,
            entityId: attendue.entityId,
            isRecursive: attendue.isRecursive,
            isDynamic: true,
          })
          // Une habilitation manuelle deja presente sur le meme triplet est
          // laissee telle quelle : elle ne doit pas devenir dynamique, donc
          // revocable, a cause d'une correspondance de groupe.
          .onConflictDoNothing();
      }

      if (revoked > 0) {
        this.logger.log(
          `${String(revoked)} habilitation(s) dynamique(s) revoquee(s) pour l'utilisateur ${String(userId)}.`,
        );
      }

      return { userId, granted: attendues.length, revoked };
    });
  }
}
