import { ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withRequestContext } from '@tick/db';
import { GroupsService } from '../admin/groups.service.js';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { createFixture, exactly, withSubtree, type Fixture } from './fixtures.js';

/**
 * Les tables sans politique de sécurité, et ce que le rôle applicatif y garde.
 *
 * Le rôle applicatif est celui des requêtes de l'API — et du SQL des plugins.
 * Sur les tables globales, il n'a plus que ce dont l'application a besoin.
 */
describe('Tables globales', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('GLOB');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  const app = (requete: ReturnType<typeof sql>) => fixture.app.db.execute(requete);
  const droit = async (objet: string, privilege: string) => {
    const resultat = await fixture.owner.db.execute<{ ok: boolean }>(
      sql`SELECT has_table_privilege('tick_app', ${objet}, ${privilege}) AS ok`,
    );

    return resultat.rows[0]?.ok;
  };

  describe('comptes', () => {
    it('ne laisse pas lire les condensats de mots de passe', async () => {
      await expect(app(sql`SELECT password_hash FROM users LIMIT 1`)).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    });

    it('laisse lire toutes les autres colonnes, y compris celles ajoutées depuis', async () => {
      // Un droit de colonne ne s'étend pas aux colonnes futures : une colonne
      // ajoutée sans être accordée rendrait illisible toute requête qui la cite.
      const resultat = await fixture.owner.db.execute<{ colonne: string; lisible: boolean }>(sql`
        SELECT column_name AS colonne,
               has_column_privilege('tick_app', 'users', column_name, 'SELECT') AS lisible
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
      `);

      const illisibles = resultat.rows.filter((ligne) => !ligne.lisible).map((l) => l.colonne);

      expect(illisibles).toEqual(['password_hash']);
    });

    it('laisse encore écrire un condensat, pour l’administration des comptes', async () => {
      expect(await droit('users', 'INSERT')).toBe(true);
      expect(await droit('users', 'UPDATE')).toBe(true);
    });
  });

  it.each(['ldap_directories', 'plugins', 'plugin_migrations'])(
    'ferme %s au rôle applicatif',
    async (table) => {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await droit(table, privilege), `${table} ${privilege}`).toBe(false);
      }
    },
  );

  describe('appartenances aux groupes', () => {
    const groupe = (cle: string) => fixture.groupIds[cle] as number;
    const compte = async () => {
      const resultat = await fixture.owner.db.execute<{ id: number }>(
        sql`SELECT id FROM users WHERE username = 'admin'`,
      );

      return Number(resultat.rows[0]?.id);
    };

    const ajouter = (contexte: ReturnType<typeof exactly>, groupeId: number, userId: number) =>
      withRequestContext(fixture.app.db, contexte, (tx) =>
        tx.execute(sql`
          INSERT INTO group_members (group_id, user_id, is_manager, is_dynamic)
          VALUES (${groupeId}, ${userId}, false, false)
        `),
      );

    afterAll(async () => {
      await fixture.owner.db.execute(
        sql`DELETE FROM group_members WHERE group_id IN (${sql.join(
          Object.values(fixture.groupIds).map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    });

    it('se modifient dans l’entité du groupe', async () => {
      await ajouter(exactly(fixture.paths['siteA'] as string), groupe('equipeA'), await compte());

      const lignes = await fixture.owner.db.execute(
        sql`SELECT 1 FROM group_members WHERE group_id = ${groupe('equipeA')}`,
      );

      expect(lignes.rows).toHaveLength(1);
    });

    it('ne se modifient pas depuis une sous-entité, même si le groupe y est visible', async () => {
      // `partage` est récursif et défini à la racine : visible depuis Site A,
      // assignable depuis Site A, mais pas modifiable depuis Site A.
      await expect(
        ajouter(exactly(fixture.paths['siteA'] as string), groupe('partage'), await compte()),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it('restent lisibles d’une entité à l’autre', async () => {
      const lues = await withRequestContext(
        fixture.app.db,
        withSubtree(fixture.paths['siteB'] as string),
        (tx) => tx.execute(sql`SELECT 1 FROM group_members WHERE group_id = ${groupe('equipeA')}`),
      );

      expect(lues.rows).toHaveLength(1);
    });

    it('disent pourquoi le service refuse', async () => {
      const service = new GroupsService(
        new DatabaseService(fixture.app.db, fixture.owner.db, {
          owner: fixture.owner,
          app: fixture.app,
        }),
      );
      const chemin = fixture.paths['siteA'] as string;

      const refus = await runWithContext(
        {
          sessionId: 'test',
          userId: 1,
          profileId: 1,
          entityId: fixture.entityIds['siteA'] as number,
          entityPath: chemin,
          includeSubEntities: false,
          locale: 'fr',
          profileInterface: 'standard',
          scope: { subtreePaths: [], exactPaths: [chemin] },
        },
        () =>
          service
            .addMember(groupe('partage'), { userId: 1, isManager: false })
            .catch((erreur: unknown) => erreur),
      );

      expect(refus).toBeInstanceOf(ForbiddenException);
      expect((refus as Error).message).toMatch(/se gerent depuis celle-ci/);
    });
  });
});
