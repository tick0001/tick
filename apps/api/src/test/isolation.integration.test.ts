import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities, groups, sql, withRequestContext } from '@tick/db';
import { createFixture, exactly, pathOf, withSubtree, type Fixture } from './fixtures.js';

/**
 * Les tests d'isolation, critere de sortie du jalon J1.
 *
 * Ils tournent contre une vraie base PostgreSQL avec le role applicatif, celui
 * qui subit le Row-Level Security. Les executer avec le role proprietaire les
 * ferait tous passer sans rien prouver : c'est precisement le piege que le
 * preambule de migration ferme en creant le role dans le schema lui-meme.
 */
describe('Isolation entre entites', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('TEST');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  it('confine un technicien de Site A a sa seule entite', async () => {
    const visibles = await withRequestContext(
      fixture.app.db,
      exactly(fixture.paths['siteA'] as string),
      (tx) => tx.select({ id: entities.id }).from(entities),
    );

    expect(visibles.map((e) => e.id)).toEqual([fixture.entityIds['siteA']]);
  });

  it('rend un objet de configuration recursif visible depuis une sous-entite, mais pas un objet local', async () => {
    const visibles = await withRequestContext(
      fixture.app.db,
      exactly(fixture.paths['siteA'] as string),
      (tx) => tx.select({ id: groups.id }).from(groups),
    );

    const ids = visibles.map((g) => g.id);

    // Defini a la racine avec le drapeau recursif : utilisable partout en dessous.
    expect(ids).toContain(fixture.groupIds['partage']);
    // Defini a la racine sans le drapeau : n'existe que pour la racine.
    expect(ids).not.toContain(fixture.groupIds['local']);
    // Defini dans l'entite active.
    expect(ids).toContain(fixture.groupIds['equipeA']);
    // Defini dans une entite soeur : invisible.
    expect(ids).not.toContain(fixture.groupIds['equipeB']);
  });

  it('confine aussi une requete SQL brute, comme en ecrirait un plugin', async () => {
    const lignes = await withRequestContext(
      fixture.app.db,
      exactly(fixture.paths['siteA'] as string),
      async (tx) => {
        const resultat = await tx.execute<{ id: number } & Record<string, unknown>>(
          sql`SELECT id FROM entities`,
        );

        return resultat.rows;
      },
    );

    expect(lignes.map((l) => l.id)).toEqual([fixture.entityIds['siteA']]);
  });

  it('ouvre la descendance a une habilitation recursive, et elle seule', async () => {
    const recursif = await withRequestContext(
      fixture.app.db,
      withSubtree(fixture.paths['nord'] as string),
      (tx) => tx.select({ id: entities.id }).from(entities),
    );

    expect(recursif.map((e) => e.id).sort()).toEqual(
      [fixture.entityIds['nord'], fixture.entityIds['siteA'], fixture.entityIds['siteB']].sort(),
    );

    const simple = await withRequestContext(
      fixture.app.db,
      exactly(fixture.paths['nord'] as string),
      (tx) => tx.select({ id: entities.id }).from(entities),
    );

    expect(simple.map((e) => e.id)).toEqual([fixture.entityIds['nord']]);
  });

  it('repercute un deplacement de sous-arbre sur les chemins et sur les visibilites', async () => {
    const siteA = fixture.entityIds['siteA'] as number;

    // Site A passe de Filiale Nord au Siege.
    await fixture.owner.db.execute(
      sql`UPDATE entities SET parent_id = ${fixture.entityIds['siege']} WHERE id = ${siteA}`,
    );

    const nouveauChemin = await pathOf(fixture, siteA);
    expect(nouveauChemin.startsWith(`${fixture.paths['siege'] as string}.`)).toBe(true);

    // Le groupe de Site A a suivi son entite.
    const [groupe] = await fixture.owner.db
      .select({ entityPath: groups.entityPath })
      .from(groups)
      .where(sql`${groups.id} = ${fixture.groupIds['equipeA']}`);

    expect(groupe?.entityPath).toBe(nouveauChemin);

    // Filiale Nord ne voit plus Site A ; le Siege le voit desormais.
    const depuisNord = await withRequestContext(
      fixture.app.db,
      withSubtree(fixture.paths['nord'] as string),
      (tx) => tx.select({ id: entities.id }).from(entities),
    );
    expect(depuisNord.map((e) => e.id)).not.toContain(siteA);

    const depuisSiege = await withRequestContext(
      fixture.app.db,
      withSubtree(fixture.paths['siege'] as string),
      (tx) => tx.select({ id: entities.id }).from(entities),
    );
    expect(depuisSiege.map((e) => e.id)).toContain(siteA);

    // Remise en place pour ne pas dependre de l'ordre des tests.
    await fixture.owner.db.execute(
      sql`UPDATE entities SET parent_id = ${fixture.entityIds['nord']} WHERE id = ${siteA}`,
    );
  });

  /**
   * L'invariant dont depend la liste des tickets.
   *
   * `TicketsService.paginate` lit le nom de l'entite par une sous-requete
   * scalaire et non par une jointure interne, parce que la jointure empechait
   * l'usage de l'index de tri. Le changement n'est correct que si aucun ticket
   * visible n'a d'entite invisible : sinon la liste montrerait une ligne au nom
   * d'entite vide la ou l'ancienne requete l'ecartait.
   *
   * La garantie vient de `entities_propagate_path_trg`, qui recopie le chemin
   * de l'entite sur ses tickets dans la transaction meme du deplacement. Ce
   * test l'exerce la ou elle risque le plus de ceder : pendant un deplacement
   * de sous-arbre.
   */
  it('ne laisse jamais un ticket visible avec une entite invisible', async () => {
    const siteA = fixture.entityIds['siteA'] as number;

    await fixture.owner.db.execute(sql`
      INSERT INTO tickets (entity_id, entity_path, name)
      VALUES (${siteA}, 'temporaire', 'Ticket de controle')
    `);

    const orphelins = async (chemin: string): Promise<number> => {
      const lignes = await withRequestContext(fixture.app.db, withSubtree(chemin), (tx) =>
        tx.execute<{ orphelins: number }>(sql`
          SELECT count(*)::int AS orphelins
            FROM tickets
           WHERE tickets.deleted_at IS NULL
             AND (SELECT e.id FROM entities e WHERE e.id = tickets.entity_id) IS NULL
        `),
      );

      return Number(lignes.rows[0]?.orphelins ?? -1);
    };

    expect(await orphelins(fixture.paths['nord'] as string)).toBe(0);

    // Site A passe de Filiale Nord au Siege : les tickets doivent suivre.
    await fixture.owner.db.execute(
      sql`UPDATE entities SET parent_id = ${fixture.entityIds['siege']} WHERE id = ${siteA}`,
    );

    expect(await orphelins(fixture.paths['nord'] as string)).toBe(0);
    expect(await orphelins(fixture.paths['siege'] as string)).toBe(0);

    // Et le ticket est bien passe d'un perimetre a l'autre, sans disparaitre.
    const compter = async (chemin: string): Promise<number> => {
      const lignes = await withRequestContext(fixture.app.db, withSubtree(chemin), (tx) =>
        tx.execute<{ total: number }>(
          sql`SELECT count(*)::int AS total FROM tickets WHERE name = 'Ticket de controle'`,
        ),
      );

      return Number(lignes.rows[0]?.total ?? -1);
    };

    expect(await compter(fixture.paths['nord'] as string)).toBe(0);
    expect(await compter(fixture.paths['siege'] as string)).toBe(1);

    await fixture.owner.db.execute(
      sql`UPDATE entities SET parent_id = ${fixture.entityIds['nord']} WHERE id = ${siteA}`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM tickets WHERE name = 'Ticket de controle'`);
  });

  it('refuse une ecriture hors du perimetre', async () => {
    await expect(
      withRequestContext(fixture.app.db, exactly(fixture.paths['siteA'] as string), (tx) =>
        tx.insert(entities).values({
          parentId: fixture.entityIds['siteB'] as number,
          name: 'TEST intrusion',
          path: 'temporaire',
          completeName: 'intrusion',
        }),
      ),
    ).rejects.toThrow();
  });

  it("ne montre rien en l'absence de contexte", async () => {
    // Une connexion sans parametres de session doit voir un perimetre vide,
    // jamais un perimetre total : c'est le comportement sur par defaut.
    const resultat = await fixture.app.db.execute<{ total: number } & Record<string, unknown>>(
      sql`SELECT count(*) AS total FROM entities`,
    );

    expect(resultat.rows[0]?.total).toBe(0);
  });
});
