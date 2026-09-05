import { Injectable, Logger } from '@nestjs/common';
import { and, authorizations, eq, ldapDirectories, users } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import { RulesService } from '../rules/rules.service.js';
import type { LdapDirectory, LdapProfile } from './ldap.service.js';

export interface SyncResult {
  userId: number;
  /** Habilitations dynamiques posees ou conservees. */
  granted: number;
  /** Habilitations dynamiques retirees parce que le groupe a ete quitte. */
  revoked: number;
}

interface Attendue {
  profileId: number;
  entityId: number;
  isRecursive: boolean;
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
 * La decision revient au moteur de regles, collection `authorization.assign` :
 * une organisation peut ainsi decider sur le service, le domaine du courriel ou
 * une expression sur le nom distingue, la ou une table de correspondance ne
 * savait comparer qu'un groupe. La reconciliation, elle, est inchangee : c'est
 * elle qui garantit qu'une habilitation saisie a la main survit a une
 * synchronisation, et qu'une habilitation heritee d'un groupe disparait avec
 * lui.
 */
@Injectable()
export class LdapSyncService {
  private readonly logger = new Logger(LdapSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly rules: RulesService,
  ) {}

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
   * Reconcilie les habilitations dynamiques avec ce que les regles decident.
   *
   * Les habilitations saisies a la main (`is_dynamic = false`) ne sont ni lues
   * ni touchees : un administrateur qui accorde un acces exceptionnel ne doit
   * pas le voir disparaitre a la prochaine synchronisation.
   */
  async applyDynamicAuthorizations(userId: number, profile: LdapProfile): Promise<SyncResult> {
    const attendues = await this.decide(profile);
    const attenduesParCle = new Map(attendues.map((attendue) => [keyOf(attendue), attendue]));

    return this.db.asOwner(async (tx) => {
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

  /**
   * Traduit un profil d'annuaire en habilitations attendues.
   *
   * Chaque regle qui correspond produit **une** habilitation : la collection
   * s'evalue sans chainage, sinon la deuxieme regle verrait le profil pose par
   * la premiere et ne s'appliquerait plus. Une regle incomplete — sans profil
   * ou sans entite — est ignoree avec un avertissement plutot que d'ecrire une
   * habilitation a moitie definie.
   */
  private async decide(profile: LdapProfile): Promise<Attendue[]> {
    const { traces } = await this.rules.runForEntity('authorization.assign', null, {
      uid: profile.login,
      mail: profile.email,
      domain: profile.email?.split('@')[1] ?? null,
      dn: profile.dn,
      commonName: [profile.firstName, profile.lastName].filter(Boolean).join(' '),
      groups: profile.groupDns,
    });

    const attendues: Attendue[] = [];

    for (const trace of traces) {
      if (!trace.matched) continue;

      const decide = new Map(trace.applied.map((action) => [action.field, action.value]));
      const profileId = Number(decide.get('profileId'));
      const entityId = Number(decide.get('entityId'));

      if (!Number.isInteger(profileId) || !Number.isInteger(entityId)) {
        this.logger.warn(
          `Regle « ${trace.name} » ignoree : profil ou entite manquant dans ses actions.`,
        );
        continue;
      }

      attendues.push({
        profileId,
        entityId,
        isRecursive: (decide.get('isRecursive') ?? 'false') === 'true',
      });
    }

    return attendues;
  }
}
