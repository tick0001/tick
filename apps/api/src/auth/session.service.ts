import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sessions, sql } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';

/** Duree de vie glissante d'une session inactive. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionRecord {
  id: string;
  userId: number;
  profileId: number;
  entityId: number;
  includeSubEntities: boolean;
}

export interface IssuedSession extends SessionRecord {
  /** Valeur a poser dans le cookie. Le serveur n'en conserve que le condensat. */
  cookieValue: string;
}

function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Sessions opaques, revocables cote serveur.
 *
 * Un jeton opaque plutot qu'un JWT : la revocation immediate compte davantage
 * ici que l'absence d'acces a la base, et une deconnexion doit prendre effet
 * tout de suite. Seul le condensat du secret est stocke, donc une fuite de la
 * base ne permet pas de rejouer les sessions.
 */
@Injectable()
export class SessionService {
  constructor(private readonly db: DatabaseService) {}

  async issue(
    record: Omit<SessionRecord, 'id'>,
    metadata: { userAgent?: string | undefined; ipAddress?: string | undefined },
  ): Promise<IssuedSession> {
    const secret = randomBytes(32).toString('base64url');

    const [created] = await this.db.asOwner((tx) =>
      tx
        .insert(sessions)
        .values({
          userId: record.userId,
          profileId: record.profileId,
          entityId: record.entityId,
          includeSubEntities: record.includeSubEntities,
          refreshTokenHash: digest(secret),
          userAgent: metadata.userAgent ?? null,
          ipAddress: metadata.ipAddress ?? null,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        })
        .returning(),
    );

    if (!created) throw new Error('Creation de session impossible.');

    return {
      id: created.id,
      userId: created.userId,
      profileId: created.profileId,
      entityId: created.entityId,
      includeSubEntities: created.includeSubEntities,
      cookieValue: `${created.id}.${secret}`,
    };
  }

  /** Resout un cookie en session valide, en prolongeant sa duree de vie. */
  async resolve(cookieValue: string | undefined): Promise<SessionRecord | null> {
    if (!cookieValue) return null;

    const separator = cookieValue.indexOf('.');
    if (separator <= 0) return null;

    const id = cookieValue.slice(0, separator);
    const secret = cookieValue.slice(separator + 1);

    return this.db.asOwner(async (tx) => {
      const [found] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));

      if (!found || found.expiresAt.getTime() < Date.now()) return null;

      // Comparaison a temps constant : une comparaison naive laisserait fuir la
      // longueur du prefixe commun, donc le secret, octet par octet.
      const expected = Buffer.from(found.refreshTokenHash, 'utf8');
      const actual = Buffer.from(digest(secret), 'utf8');

      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

      await tx
        .update(sessions)
        .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
        .where(eq(sessions.id, id));

      return {
        id: found.id,
        userId: found.userId,
        profileId: found.profileId,
        entityId: found.entityId,
        includeSubEntities: found.includeSubEntities,
      };
    });
  }

  /** Change l'entite ou le profil actif sans rouvrir de session. */
  async switchContext(
    sessionId: string,
    context: { entityId: number; profileId: number; includeSubEntities: boolean },
  ): Promise<void> {
    await this.db.asOwner((tx) =>
      tx.update(sessions).set(context).where(eq(sessions.id, sessionId)),
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.asOwner((tx) =>
      tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId)),
    );
  }

  /** Purge les sessions expirees. Appelee par une tache planifiee. */
  async purgeExpired(): Promise<number> {
    return this.db.asOwner(async (tx) => {
      const result = await tx.execute(
        sql`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`,
      );

      return result.rowCount ?? 0;
    });
  }
}
