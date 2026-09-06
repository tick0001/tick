import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileRights, profiles, sql, users } from '@tick/db';
import { PasswordService } from '../auth/password.service.js';
import { RightsService } from '../auth/rights.service.js';
import { GroupsService } from '../admin/groups.service.js';
import { ProfilesService } from '../admin/profiles.service.js';
import { RIGHT_CATALOGUE } from '../admin/right-catalogue.js';
import { UsersService } from '../admin/users.service.js';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * Administration : comptes, groupes, profils et droits.
 *
 * Ce qui se casse en silence ici a la pire conséquence possible : un droit
 * retiré qui continue de s'appliquer, ou une habilitation accordée qui ne prend
 * pas effet. Dans les deux cas, l'écran dit une chose et le système en fait une
 * autre — et personne ne s'en aperçoit avant l'incident.
 */
describe('Administration', () => {
  let fixture: Fixture;
  let db: DatabaseService;
  let rights: RightsService;
  let usersService: UsersService;
  let groupsService: GroupsService;
  let profilesService: ProfilesService;

  const ids = { profilAdmin: 0, admin: 0, profilCree: 0, compteCree: 0 };

  const dans = <T>(profileId: number, userId: number, work: () => Promise<T>): Promise<T> => {
    const path = fixture.paths['racine'] as string;

    return runWithContext(
      {
        sessionId: 'test',
        userId,
        profileId,
        entityId: fixture.entityIds['racine'] as number,
        entityPath: path,
        includeSubEntities: true,
        locale: 'fr',
        scope: { subtreePaths: [path], exactPaths: [] },
      },
      work,
    );
  };

  const commeAdmin = <T>(work: () => Promise<T>): Promise<T> =>
    dans(ids.profilAdmin, ids.admin, work);

  beforeAll(async () => {
    fixture = await createFixture('ADM');

    db = new DatabaseService(fixture.app.db, fixture.owner.db, {
      owner: fixture.owner,
      app: fixture.app,
    });

    rights = new RightsService(db);
    usersService = new UsersService(db, new PasswordService());
    groupsService = new GroupsService(db);
    profilesService = new ProfilesService(db, rights);

    const [profil] = await fixture.owner.db
      .insert(profiles)
      .values({ name: `ADM Admin ${String(Date.now())}` })
      .returning({ id: profiles.id });

    ids.profilAdmin = (profil as { id: number }).id;

    await fixture.owner.db.insert(profileRights).values([
      { profileId: ids.profilAdmin, object: 'user', action: 'read', scope: 'all' },
      { profileId: ids.profilAdmin, object: 'group', action: 'read', scope: 'all' },
      { profileId: ids.profilAdmin, object: 'profile', action: 'update', scope: 'all' },
    ]);

    const [compte] = await fixture.owner.db
      .insert(users)
      .values({ username: `adm-admin-${String(Date.now())}` })
      .returning({ id: users.id });

    ids.admin = (compte as { id: number }).id;
  });

  afterAll(async () => {
    await fixture.owner.db.execute(
      sql`DELETE FROM authorizations WHERE user_id IN (${ids.admin}, ${ids.compteCree})`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM profiles WHERE id IN (${ids.profilAdmin}, ${ids.profilCree})`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM users WHERE id IN (${ids.admin}, ${ids.compteCree})`,
    );
    await fixture.cleanup();
  });

  describe('Catalogue des droits', () => {
    it('couvre tout ce que le code exige réellement', () => {
      // Un droit exigé par un contrôleur mais absent du catalogue serait
      // impossible à accorder depuis l'écran des profils : l'écran existerait,
      // et resterait inatteignable.
      const exiges: readonly [string, string][] = [
        ['ticket', 'read'],
        ['ticket', 'create'],
        ['ticket', 'update'],
        ['ticket', 'delete'],
        ['problem', 'read'],
        ['change', 'read'],
        ['planning', 'read'],
        ['planning', 'update'],
        ['recurrence', 'read'],
        ['recurrence', 'update'],
        ['stats', 'read'],
        ['kb', 'read'],
        ['kb', 'update'],
        ['form', 'read'],
        ['form', 'update'],
        ['slm', 'read'],
        ['slm', 'update'],
        ['rule', 'read'],
        ['rule', 'update'],
        ['notification', 'read'],
        ['notification', 'update'],
        ['mailcollector', 'read'],
        ['mailcollector', 'update'],
        ['satisfaction', 'read'],
        ['satisfaction', 'update'],
        ['entity', 'read'],
        ['entity', 'create'],
        ['entity', 'update'],
        ['entity', 'delete'],
        ['user', 'read'],
        ['user', 'create'],
        ['user', 'update'],
        ['group', 'read'],
        ['group', 'create'],
        ['group', 'update'],
        ['group', 'delete'],
        ['profile', 'read'],
        ['profile', 'update'],
        ['plugin', 'read'],
        ['plugin', 'update'],
        ['plugin', 'delete'],
      ];

      const manquants = exiges.filter(
        ([object, action]) =>
          !RIGHT_CATALOGUE.some(
            (entree) => entree.object === object && entree.actions.includes(action),
          ),
      );

      expect(manquants).toEqual([]);
    });

    it('n’offre pas de portée qui n’a pas de sens', () => {
      // Un modèle de notification n'appartient à personne : proposer « les
      // miens » enverrait chercher pendant un quart d'heure pourquoi le choix
      // ne change rien.
      const notification = RIGHT_CATALOGUE.find((entree) => entree.object === 'notification');

      expect(notification?.scopes).not.toContain('own');
      expect(notification?.scopes).toContain('recursive');
    });
  });

  describe('Profils', () => {
    it('refuse un droit absent du catalogue', async () => {
      await expect(
        commeAdmin(() =>
          profilesService.save({
            name: 'ADM Bidon',
            interface: 'standard',
            isDefault: false,
            rights: [{ object: 'ticket', action: 'explose', scope: 'all' }],
          }),
        ),
      ).rejects.toThrow(/inconnu/i);
    });

    it('enregistre la matrice et invalide le cache de droits', async () => {
      const cree = await commeAdmin(() =>
        profilesService.save({
          name: `ADM Lecteur ${String(Date.now())}`,
          interface: 'standard',
          isDefault: false,
          rights: [{ object: 'ticket', action: 'read', scope: 'entity' }],
        }),
      );

      ids.profilCree = cree.id;

      expect(await rights.scopeFor(cree.id, 'ticket', 'read')).toBe('entity');

      // Le cache est en mémoire : sans invalidation, le droit retiré
      // continuerait de s'appliquer jusqu'au prochain redémarrage.
      await commeAdmin(() =>
        profilesService.save(
          {
            name: cree.name,
            interface: 'standard',
            isDefault: false,
            rights: [{ object: 'ticket', action: 'read', scope: 'own' }],
          },
          cree.id,
        ),
      );

      expect(await rights.scopeFor(cree.id, 'ticket', 'read')).toBe('own');
    });

    it('refuse de supprimer un profil encore utilisé', async () => {
      await expect(commeAdmin(() => profilesService.remove(ids.profilAdmin))).rejects.toThrow(
        /utilise|utilisez/i,
      );
    });
  });

  describe('Comptes et habilitations', () => {
    it('crée un compte, l’habilite, et la révoque', async () => {
      const cree = await commeAdmin(() =>
        usersService.create({
          username: `adm-cree-${String(Date.now())}`,
          isActive: true,
          password: 'motdepasse-long',
        }),
      );

      ids.compteCree = cree.id;

      // Un compte sans habilitation ne peut pas se connecter : c'est le piège
      // que l'écran signale explicitement.
      expect(cree.authorizations).toEqual([]);

      const apresOctroi = await commeAdmin(() =>
        usersService.grant(cree.id, {
          entityId: fixture.entityIds['siteA'] as number,
          profileId: ids.profilCree,
          isRecursive: true,
        }),
      );

      expect(apresOctroi).toHaveLength(1);
      expect(apresOctroi[0]?.isRecursive).toBe(true);

      // Réaccorder la même corrige la portée plutôt que d'échouer.
      const corrigee = await commeAdmin(() =>
        usersService.grant(cree.id, {
          entityId: fixture.entityIds['siteA'] as number,
          profileId: ids.profilCree,
          isRecursive: false,
        }),
      );

      expect(corrigee[0]?.isRecursive).toBe(false);

      const apresRetrait = await commeAdmin(() =>
        usersService.revoke(
          cree.id,
          fixture.entityIds['siteA'] as number,
          ids.profilCree,
        ),
      );

      expect(apresRetrait).toEqual([]);
    });

    it('refuse de se désactiver soi-même', async () => {
      await expect(
        commeAdmin(() =>
          usersService.update(ids.admin, {
            username: `adm-admin-${String(Date.now())}`,
            isActive: false,
          }),
        ),
      ).rejects.toThrow(/propre compte/i);
    });

    it('refuse de retirer sa propre habilitation active', async () => {
      await expect(
        commeAdmin(() =>
          usersService.revoke(
            ids.admin,
            fixture.entityIds['racine'] as number,
            ids.profilAdmin,
          ),
        ),
      ).rejects.toThrow(/propre habilitation/i);
    });
  });

  describe('Groupes', () => {
    it('crée un groupe et gère ses membres', async () => {
      const cree = await commeAdmin(() =>
        groupsService.save({
          name: `ADM Equipe ${String(Date.now())}`,
          isRecursive: true,
          isRequester: true,
          isAssignable: true,
        }),
      );

      expect(cree.entityName).toContain('Racine');
      expect(cree.members).toEqual([]);

      const avecMembre = await commeAdmin(() =>
        groupsService.addMember(cree.id, { userId: ids.admin, isManager: true }),
      );

      expect(avecMembre.members).toHaveLength(1);
      expect(avecMembre.members[0]?.isManager).toBe(true);

      const sansMembre = await commeAdmin(() =>
        groupsService.removeMember(cree.id, ids.admin),
      );

      expect(sansMembre.members).toEqual([]);

      await commeAdmin(() => groupsService.remove(cree.id));

      const restants = await commeAdmin(() => groupsService.list());

      expect(restants.some((groupe) => groupe.id === cree.id)).toBe(false);
    });
  });
});
