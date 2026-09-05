import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AvailableContext, SessionContext } from '@tick/contracts';
import { and, eq, isNull, users } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import { LdapSyncService } from '../ldap/ldap-sync.service.js';
import { LdapService } from '../ldap/ldap.service.js';
import { PasswordService } from './password.service.js';
import { RightsService } from './rights.service.js';
import { ScopeService, type AuthorizedEntity } from './scope.service.js';
import { SessionService, type IssuedSession, type SessionRecord } from './session.service.js';

export interface LoginMetadata {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

function displayNameOf(user: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}): string {
  const parts = [user.firstName, user.lastName].filter(Boolean);

  return parts.length > 0 ? parts.join(' ') : user.username;
}

function toAvailableContext(row: AuthorizedEntity): AvailableContext {
  return {
    entity: {
      id: row.entityId,
      name: row.name,
      completeName: row.completeName,
      path: row.entityPath,
      level: row.entityPath.split('.').length - 1,
      parentId: null,
    },
    profile: { id: row.profileId, name: row.profileName, interface: row.profileInterface },
    isRecursive: row.isRecursive,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly scopes: ScopeService,
    private readonly rights: RightsService,
    private readonly ldap: LdapService,
    private readonly ldapSync: LdapSyncService,
  ) {}

  /**
   * Authentifie un utilisateur et ouvre une session.
   *
   * Le message d'erreur est volontairement identique pour un identifiant
   * inconnu, un mot de passe faux et un compte desactive : distinguer les cas
   * revient a offrir un oracle d'existence de comptes.
   */
  async login(username: string, password: string, metadata: LoginMetadata): Promise<IssuedSession> {
    const local = await this.findByUsername(username);
    const localValid = await this.passwords.verify(local?.passwordHash ?? null, password);

    // L'annuaire n'est interroge que si l'authentification locale echoue :
    // un compte local reste utilisable meme annuaire injoignable, ce qui evite
    // de perdre l'acces administrateur en cas de panne reseau.
    const user = localValid ? local : await this.authenticateAgainstDirectories(username, password);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const available = await this.scopes.authorizedEntities(user.id);
    const chosen = available.find((row) => row.entityId === user.defaultEntityId) ?? available[0];

    if (!chosen) {
      throw new UnauthorizedException('Aucune habilitation : acces impossible.');
    }

    await this.db.asOwner((tx) =>
      tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)),
    );

    return this.sessions.issue(
      {
        userId: user.id,
        profileId: chosen.profileId,
        entityId: chosen.entityId,
        includeSubEntities: chosen.isRecursive,
      },
      metadata,
    );
  }

  /** Etat complet de la session : qui, ou, avec quels droits, et vers quoi basculer. */
  async describeSession(session: SessionRecord): Promise<SessionContext> {
    const [user] = await this.db.asOwner((tx) =>
      tx.select().from(users).where(eq(users.id, session.userId)),
    );

    if (!user) throw new UnauthorizedException('Session orpheline.');

    const available = await this.scopes.authorizedEntities(session.userId);
    const active = available.find(
      (row) => row.entityId === session.entityId && row.profileId === session.profileId,
    );

    if (!active) throw new UnauthorizedException('Habilitation revoquee.');

    const rights = await this.rights.rightsFor(session.profileId);

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: displayNameOf(user),
        email: user.email,
        locale: user.locale ?? 'fr',
      },
      entity: toAvailableContext(active).entity,
      profile: {
        id: active.profileId,
        name: active.profileName,
        interface: active.profileInterface,
      },
      includeSubEntities: session.includeSubEntities,
      rights: Object.fromEntries(rights),
      available: available.map(toAvailableContext),
    };
  }

  /** Bascule d'entite ou de profil sans rouvrir de session. */
  async switchContext(
    session: SessionRecord,
    target: { entityId: number; profileId: number; includeSubEntities: boolean },
  ): Promise<SessionContext> {
    // Verifie l'habilitation avant d'ecrire : la resolution du perimetre leve
    // une exception si aucune habilitation ne couvre la cible.
    const scope = await this.scopes.workingScope(
      session.userId,
      target.entityId,
      target.profileId,
      target.includeSubEntities,
    );

    await this.sessions.switchContext(session.id, {
      entityId: target.entityId,
      profileId: target.profileId,
      includeSubEntities: scope.includeSubEntities,
    });

    return this.describeSession({
      ...session,
      entityId: target.entityId,
      profileId: target.profileId,
      includeSubEntities: scope.includeSubEntities,
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  private async findByUsername(username: string): Promise<typeof users.$inferSelect | undefined> {
    const [user] = await this.db.asOwner((tx) =>
      tx
        .select()
        .from(users)
        .where(and(eq(users.username, username), isNull(users.deletedAt))),
    );

    return user;
  }

  /**
   * Tente l'authentification contre chaque annuaire actif, par defaut d'abord.
   *
   * Une authentification reussie declenche la synchronisation du compte et la
   * reconciliation des habilitations dynamiques : les droits sont ainsi a jour
   * des la premiere requete de la session, et non a la prochaine tache planifiee.
   */
  private async authenticateAgainstDirectories(
    username: string,
    password: string,
  ): Promise<typeof users.$inferSelect | undefined> {
    for (const directory of await this.ldap.activeDirectories()) {
      const profile = await this.ldap.authenticate(directory, username, password);

      if (!profile) continue;

      const userId = await this.ldapSync.upsertUser(directory, profile);
      const result = await this.ldapSync.applyDynamicAuthorizations(userId, profile);

      if (result.revoked > 0) this.rights.invalidate();

      return this.findByUsername(profile.login);
    }

    return undefined;
  }
}
