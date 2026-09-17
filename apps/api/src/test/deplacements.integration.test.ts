import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities, groups, sql, withRequestContext } from '@tick/db';
import { createFixture, exactly, pathOf, withSubtree, type Fixture } from './fixtures.js';

/**
 * Les déplacements, faits comme l'API les fait : avec le rôle applicatif.
 *
 * Le test d'isolation déplace une entité en propriétaire, hors RLS, et ne pouvait
 * donc pas voir ce qui cédait sous le rôle applicatif : la propagation des
 * chemins s'y heurtait à la politique des objets de configuration, qui exige en
 * écriture le chemin de l'entité active, et n'atteignait pas la descendance
 * invisible de l'auteur du déplacement.
 */
describe('Déplacements sous le rôle applicatif', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('DEPL');
  }, 30_000);

  afterAll(async () => {
    await fixture.owner.db.execute(
      sql`DELETE FROM itil_categories WHERE name LIKE 'DEPL %' AND parent_id IS NOT NULL`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM itil_categories WHERE name LIKE 'DEPL %'`);
    await fixture.cleanup();
  });

  const id = (cle: string) => fixture.entityIds[cle] as number;
  const chemin = (cle: string) => fixture.paths[cle] as string;

  /** Une catégorie, écrite en propriétaire ; son chemin est calculé par déclencheur. */
  async function categorie(
    nom: string,
    entite: string,
    parent: number | null,
    recursive = true,
  ): Promise<number> {
    const resultat = await fixture.owner.db.execute<{ id: number }>(sql`
      INSERT INTO itil_categories (name, entity_id, entity_path, is_recursive, parent_id, path, complete_name)
      VALUES (${'DEPL ' + nom}, ${id(entite)}, 'x', ${recursive}, ${parent}, 'x', 'x')
      RETURNING id
    `);

    return Number(resultat.rows[0]?.id);
  }

  async function lireCategorie(categorieId: number) {
    const resultat = await fixture.owner.db.execute<{ path: string; nom: string }>(
      sql`SELECT path::text AS path, complete_name AS nom FROM itil_categories WHERE id = ${categorieId}`,
    );

    return resultat.rows[0];
  }

  it('déplace une entité qui porte un groupe', async () => {
    const siteA = id('siteA');

    // Depuis la racine, avec toute sa descendance : le déplacement est permis.
    await withRequestContext(fixture.app.db, withSubtree(chemin('racine')), (tx) =>
      tx.execute(sql`UPDATE entities SET parent_id = ${id('siege')} WHERE id = ${siteA}`),
    );

    const nouveau = await pathOf(fixture, siteA);

    expect(nouveau.startsWith(`${chemin('siege')}.`)).toBe(true);

    const [groupe] = await fixture.owner.db
      .select({ entityPath: groups.entityPath })
      .from(groups)
      .where(sql`${groups.id} = ${fixture.groupIds['equipeA']}`);

    expect(groupe?.entityPath).toBe(nouveau);

    await fixture.owner.db.execute(
      sql`UPDATE entities SET parent_id = ${id('nord')} WHERE id = ${siteA}`,
    );
  });

  it('refuse toujours un déplacement hors du périmètre', async () => {
    // Le correctif porte sur la propagation, pas sur le droit de déplacer :
    // depuis Filiale Nord, Site A ne peut pas partir sous le Siège.
    const tentative = withRequestContext(fixture.app.db, withSubtree(chemin('nord')), (tx) =>
      tx.execute(sql`UPDATE entities SET parent_id = ${id('siege')} WHERE id = ${id('siteA')}`),
    );

    await expect(tentative).rejects.toThrow();
    expect(await pathOf(fixture, id('siteA'))).toBe(chemin('siteA'));

    const [siteA] = await fixture.owner.db
      .select({ parentId: entities.parentId })
      .from(entities)
      .where(sql`${entities.id} = ${id('siteA')}`);

    expect(siteA?.parentId).toBe(id('nord'));
  });

  it('déplace une catégorie dont la descendance vit dans une autre entité', async () => {
    const mere = await categorie('Materiel', 'racine', null);
    const fille = await categorie('Impression', 'nord', mere, false);
    const nouvelleMere = await categorie('Poste de travail', 'racine', null);

    await withRequestContext(fixture.app.db, withSubtree(chemin('racine')), (tx) =>
      tx.execute(sql`UPDATE itil_categories SET parent_id = ${nouvelleMere} WHERE id = ${mere}`),
    );

    const lue = await lireCategorie(fille);

    expect(lue?.nom).toBe('DEPL Poste de travail > DEPL Materiel > DEPL Impression');
    expect(lue?.path).toBe(`n${String(nouvelleMere)}.n${String(mere)}.n${String(fille)}`);
  });

  it('recalcule une descendance que l’auteur du déplacement ne voit pas', async () => {
    const mere = await categorie('Logiciel', 'racine', null);
    const fille = await categorie('Bureautique', 'nord', mere, false);

    // Racine seule, sans sa descendance : la catégorie de Filiale Nord est
    // invisible, et doit pourtant suivre le renommage de sa mère.
    await withRequestContext(fixture.app.db, exactly(chemin('racine')), async (tx) => {
      const visibles = await tx.execute<{ id: number }>(
        sql`SELECT id FROM itil_categories WHERE id = ${fille}`,
      );

      expect(visibles.rows).toHaveLength(0);

      await tx.execute(
        sql`UPDATE itil_categories SET name = 'DEPL Applications' WHERE id = ${mere}`,
      );
    });

    expect((await lireCategorie(fille))?.nom).toBe('DEPL Applications > DEPL Bureautique');
  });
});
