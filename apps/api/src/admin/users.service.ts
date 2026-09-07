import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Authorization,
  UpsertAuthorization,
  UpsertUser,
  UserDetail,
  UserFilter,
  UserSummary,
} from '@tick/contracts';
import { authorizations, sql, users, type SQL } from '@tick/db';
import { PasswordService } from '../auth/password.service.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { nomAffiche, toIso, toText } from '../common/sql.js';

/**
 * Comptes et habilitations.
 *
 * `users` n'a pas de politique de sécurité au niveau des lignes : c'est une
 * table de référence globale, comme `profiles`. L'accès y est donc gardé par le
 * droit `user:*` au contrôleur, et rien d'autre — d'où l'importance que ce droit
 * ne soit accordé qu'aux profils d'administration.
 *
 * Les habilitations, elles, sont protégées par le RLS : un administrateur d'une
 * filiale ne voit ni n'accorde d'habilitation hors de son périmètre.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
  ) {}

  async list(filter: UserFilter): Promise<UserSummary[]> {
    const conditions: SQL[] = [sql`u.deleted_at IS NULL`];

    if (!filter.inactive) conditions.push(sql`u.is_active`);

    if (filter.search) {
      const motif = `%${filter.search}%`;

      conditions.push(sql`(u.username::text ILIKE ${motif}
                           OR coalesce(u.email::text, '') ILIKE ${motif}
                           OR ${nomAffiche()} ILIKE ${motif})`);
    }

    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT u.id, u.username::text AS username, ${nomAffiche()} AS "displayName",
               u.email::text AS email, u.auth_source::text AS "authSource",
               u.is_active AS "isActive", u.locale, u.last_login_at AS "lastLoginAt",
               (SELECT count(*) FROM authorizations a WHERE a.user_id = u.id)
                 AS "authorizationCount",
               coalesce(
                 (SELECT array_agg(g.name ORDER BY g.name)
                    FROM group_members m JOIN groups g ON g.id = m.group_id
                   WHERE m.user_id = u.id),
                 '{}'
               ) AS groups
          FROM users u
         WHERE ${sql.join(conditions, sql` AND `)}
         ORDER BY "displayName"
         LIMIT 500
      `);

      return resultat.rows;
    });

    return lignes.map((ligne) => this.toSummary(ligne));
  }

  private toSummary(ligne: Record<string, unknown>): UserSummary {
    return {
      id: Number(ligne['id']),
      username: toText(ligne['username']),
      displayName: toText(ligne['displayName']),
      email: (ligne['email'] as string | null) ?? null,
      authSource: ligne['authSource'] as UserSummary['authSource'],
      isActive: Boolean(ligne['isActive']),
      locale: (ligne['locale'] as string | null) ?? null,
      lastLoginAt: toIso(ligne['lastLoginAt']),
      authorizationCount: Number(ligne['authorizationCount'] ?? 0),
      groups: (ligne['groups'] as string[] | null) ?? [],
    };
  }

  async findById(id: number): Promise<UserDetail> {
    const [ligne] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT u.id, u.username::text AS username, ${nomAffiche()} AS "displayName",
               u.email::text AS email, u.auth_source::text AS "authSource",
               u.is_active AS "isActive", u.locale, u.last_login_at AS "lastLoginAt",
               u.first_name AS "firstName", u.last_name AS "lastName",
               (SELECT count(*) FROM authorizations a WHERE a.user_id = u.id)
                 AS "authorizationCount",
               coalesce(
                 (SELECT array_agg(g.name ORDER BY g.name)
                    FROM group_members m JOIN groups g ON g.id = m.group_id
                   WHERE m.user_id = u.id),
                 '{}'
               ) AS groups
          FROM users u
         WHERE u.id = ${id} AND u.deleted_at IS NULL
      `);

      return resultat.rows;
    });

    if (!ligne) throw new NotFoundException('Utilisateur introuvable.');

    return {
      ...this.toSummary(ligne),
      firstName: (ligne['firstName'] as string | null) ?? null,
      lastName: (ligne['lastName'] as string | null) ?? null,
      authorizations: await this.authorizationsOf(id),
    };
  }

  /**
   * Habilitations visibles de l'utilisateur.
   *
   * La jointure sur `entities` passe par le rôle applicatif : ici, c'est
   * volontaire. Contrairement à un objet de configuration hérité, une
   * habilitation hors du périmètre ne doit **pas** apparaître — un
   * administrateur de filiale n'a pas à savoir qui est habilité au siège.
   */
  async authorizationsOf(userId: number): Promise<Authorization[]> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT a.entity_id AS "entityId", e.complete_name AS "entityName",
               a.profile_id AS "profileId", p.name AS "profileName",
               a.is_recursive AS "isRecursive", a.is_dynamic AS "isDynamic"
          FROM authorizations a
          JOIN entities e ON e.id = a.entity_id
          JOIN profiles p ON p.id = a.profile_id
         WHERE a.user_id = ${userId}
         ORDER BY e.complete_name, p.name
      `);

      return resultat.rows;
    });

    return lignes.map((ligne) => ({
      entityId: Number(ligne['entityId']),
      entityName: toText(ligne['entityName']),
      profileId: Number(ligne['profileId']),
      profileName: toText(ligne['profileName']),
      isRecursive: Boolean(ligne['isRecursive']),
      isDynamic: Boolean(ligne['isDynamic']),
    }));
  }

  async create(input: UpsertUser): Promise<UserDetail> {
    if (!input.password) {
      throw new BadRequestException('Un mot de passe est requis a la creation.');
    }

    const condensat = await this.passwords.hash(input.password);

    const [ligne] = await this.db.asUser(async (tx) =>
      tx
        .insert(users)
        .values({
          username: input.username,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          email: input.email ?? null,
          locale: input.locale ?? null,
          isActive: input.isActive,
          passwordHash: condensat,
          authSource: 'local',
        })
        .returning({ id: users.id }),
    );

    if (!ligne) throw new BadRequestException('Creation impossible.');

    return this.findById(ligne.id);
  }

  async update(id: number, input: UpsertUser): Promise<UserDetail> {
    const context = requireContext();
    const patch: Record<string, unknown> = {
      username: input.username,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      locale: input.locale ?? null,
      isActive: input.isActive,
      updatedAt: new Date(),
    };

    // Se désactiver soi-même clôt la session en cours et laisse l'installation
    // sans administrateur si c'était le dernier : le refus est plus utile que
    // la réparation en base qu'il faudrait faire ensuite.
    if (id === context.userId && !input.isActive) {
      throw new BadRequestException('Vous ne pouvez pas desactiver votre propre compte.');
    }

    if (input.password) patch['passwordHash'] = await this.passwords.hash(input.password);

    const modifies = await this.db.asUser(async (tx) =>
      tx
        .update(users)
        .set(patch)
        .where(sql`${users.id} = ${id} AND ${users.deletedAt} IS NULL`)
        .returning({ id: users.id }),
    );

    if (modifies.length === 0) throw new NotFoundException('Utilisateur introuvable.');

    return this.findById(id);
  }

  /**
   * Accorde une habilitation.
   *
   * La clé primaire est le triplet (utilisateur, profil, entité) : réaccorder la
   * même met simplement à jour la récursivité, ce qui est le comportement
   * attendu quand on corrige une portée.
   */
  async grant(userId: number, input: UpsertAuthorization): Promise<Authorization[]> {
    await this.findById(userId);

    await this.db.asUser(async (tx) => {
      await tx
        .insert(authorizations)
        .values({
          userId,
          profileId: input.profileId,
          entityId: input.entityId,
          isRecursive: input.isRecursive,
          isDynamic: false,
        })
        .onConflictDoUpdate({
          target: [authorizations.userId, authorizations.profileId, authorizations.entityId],
          set: { isRecursive: input.isRecursive, isDynamic: false },
        });
    });

    return this.authorizationsOf(userId);
  }

  /**
   * Révoque une habilitation.
   *
   * Retirer la sienne est refusé : on se couperait l'accès à l'écran qui permet
   * de la rétablir, et il faudrait rouvrir la base pour s'en sortir.
   */
  async revoke(userId: number, entityId: number, profileId: number): Promise<Authorization[]> {
    const context = requireContext();

    if (userId === context.userId && profileId === context.profileId) {
      throw new BadRequestException('Vous ne pouvez pas retirer votre propre habilitation active.');
    }

    await this.db.asUser(async (tx) => {
      await tx.execute(sql`
        DELETE FROM authorizations
         WHERE user_id = ${userId} AND entity_id = ${entityId} AND profile_id = ${profileId}
      `);
    });

    return this.authorizationsOf(userId);
  }
}
