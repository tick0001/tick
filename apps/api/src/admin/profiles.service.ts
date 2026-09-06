import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Profile, ProfileRight, UpsertProfile } from '@tick/contracts';
import { profileRights, profiles, sql } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from '../auth/rights.service.js';
import { toText } from '../tickets/ticket-sql.js';
import { estConnu } from './right-catalogue.js';

/**
 * Profils et matrice de droits.
 *
 * Les profils ne portent pas d'entité : ce sont des jeux de droits nommés,
 * réutilisables dans toute l'organisation. C'est l'**habilitation** qui les
 * rattache à une entité, et c'est elle qui rend le produit multi-organisation.
 *
 * Les droits sont remplacés en bloc à chaque enregistrement. Un différentiel
 * n'apporterait rien : la matrice est envoyée entière par l'écran, et le
 * réconcilier ligne à ligne ouvrirait la porte à un droit fantôme laissé par
 * une suppression manquée.
 */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rights: RightsService,
  ) {}

  async list(): Promise<Profile[]> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT p.id, p.name, p.interface::text AS interface,
               p.is_default AS "isDefault", p.comment,
               (SELECT count(*) FROM authorizations a WHERE a.profile_id = p.id) AS "usageCount"
          FROM profiles p
         ORDER BY p.name
      `);

      return resultat.rows;
    });

    const droits = await this.rightsByProfile();

    return lignes.map((ligne) => ({
      id: Number(ligne['id']),
      name: toText(ligne['name']),
      interface: ligne['interface'] as Profile['interface'],
      isDefault: Boolean(ligne['isDefault']),
      comment: (ligne['comment'] as string | null) ?? null,
      rights: droits.get(Number(ligne['id'])) ?? [],
      usageCount: Number(ligne['usageCount'] ?? 0),
    }));
  }

  private async rightsByProfile(): Promise<Map<number, ProfileRight[]>> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT profile_id AS "profileId", object, action, scope::text AS scope
          FROM profile_rights
         ORDER BY object, action
      `);

      return resultat.rows;
    });

    const parProfil = new Map<number, ProfileRight[]>();

    for (const ligne of lignes) {
      const id = Number(ligne['profileId']);
      const liste = parProfil.get(id) ?? [];

      liste.push({
        object: toText(ligne['object']),
        action: toText(ligne['action']),
        scope: ligne['scope'] as ProfileRight['scope'],
      });
      parProfil.set(id, liste);
    }

    return parProfil;
  }

  async save(input: UpsertProfile, id?: number): Promise<Profile> {
    for (const droit of input.rights) {
      if (!estConnu(droit.object, droit.action)) {
        throw new BadRequestException(`Droit inconnu : ${droit.object}:${droit.action}.`);
      }
    }

    const cible = await this.db.asUser(async (tx) => {
      const valeurs = {
        name: input.name,
        interface: input.interface,
        isDefault: input.isDefault,
        comment: input.comment ?? null,
        updatedAt: new Date(),
      };

      let profileId = id;

      if (profileId === undefined) {
        const [ligne] = await tx.insert(profiles).values(valeurs).returning({ id: profiles.id });

        profileId = ligne?.id;
      } else {
        const [ligne] = await tx
          .update(profiles)
          .set(valeurs)
          .where(sql`${profiles.id} = ${profileId}`)
          .returning({ id: profiles.id });

        profileId = ligne?.id;
      }

      if (profileId === undefined) return undefined;

      // Un seul profil par defaut : poser celui-ci retire le drapeau des autres,
      // sans quoi l'attribution a un nouveau compte deviendrait arbitraire.
      if (input.isDefault) {
        await tx.execute(
          sql`UPDATE profiles SET is_default = false WHERE id <> ${profileId} AND is_default`,
        );
      }

      await tx.delete(profileRights).where(sql`${profileRights.profileId} = ${profileId}`);

      if (input.rights.length > 0) {
        await tx.insert(profileRights).values(
          input.rights.map((droit) => ({
            profileId,
            object: droit.object,
            action: droit.action,
            scope: droit.scope,
          })),
        );
      }

      return profileId;
    });

    if (cible === undefined) throw new NotFoundException('Profil introuvable.');

    // Le cache de droits est en memoire : sans invalidation, l'utilisateur
    // continuerait de travailler avec l'ancienne matrice jusqu'au redemarrage.
    this.rights.invalidate(cible);

    const tous = await this.list();
    const trouve = tous.find((profil) => profil.id === cible);

    if (!trouve) throw new NotFoundException('Profil introuvable apres enregistrement.');

    return trouve;
  }

  /**
   * Supprime un profil.
   *
   * Refusé tant qu'une habilitation s'y appuie : la suppression en cascade
   * retirerait silencieusement leurs droits à des utilisateurs, et personne ne
   * ferait le lien entre la panne et le ménage de la veille.
   */
  async remove(id: number): Promise<void> {
    const context = requireContext();

    if (id === context.profileId) {
      throw new BadRequestException('Vous ne pouvez pas supprimer le profil que vous utilisez.');
    }

    const [usage] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM authorizations WHERE profile_id = ${id}`,
      );

      return resultat.rows;
    });

    if (Number(usage?.total ?? 0) > 0) {
      throw new BadRequestException(
        `Profil encore utilise par ${String(usage?.total)} habilitation(s).`,
      );
    }

    await this.db.asUser(async (tx) => {
      await tx.delete(profiles).where(sql`${profiles.id} = ${id}`);
    });

    this.rights.invalidate(id);
  }
}
