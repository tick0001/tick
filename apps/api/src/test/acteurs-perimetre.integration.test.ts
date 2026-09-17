import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withRequestContext } from '@tick/db';
import { createFixture, exactly, withSubtree, type Fixture } from './fixtures.js';

/**
 * Le périmètre des acteurs, désormais tenu par leur chemin d'entité.
 *
 * La politique interrogeait l'objet porteur à chaque ligne lue ; elle compare
 * maintenant un chemin dénormalisé. La substitution ne vaut que si elle donne
 * exactement les mêmes réponses : un acteur reste visible là où son ticket
 * l'est, et nulle part ailleurs — y compris quand l'entité du ticket bouge, et
 * y compris quand l'écriture désigne un ticket que l'auteur ne voit pas.
 */
describe('Périmètre des acteurs ITIL', () => {
  let fixture: Fixture;
  let ticketA: number;
  let ticketB: number;

  const id = (cle: string) => fixture.entityIds[cle] as number;
  const chemin = (cle: string) => fixture.paths[cle] as string;

  /** Un ticket, écrit en propriétaire ; son chemin vient du déclencheur. */
  async function ticket(nom: string, entite: string): Promise<number> {
    const resultat = await fixture.owner.db.execute<{ id: number }>(sql`
      INSERT INTO tickets (name, entity_id, entity_path)
      VALUES (${'ACT ' + nom}, ${id(entite)}, 'temporaire')
      RETURNING id
    `);

    return Number(resultat.rows[0]?.id);
  }

  /** Le chemin enregistré sur un acteur, lu hors RLS. */
  async function cheminActeur(ticketId: number): Promise<string | undefined> {
    const resultat = await fixture.owner.db.execute<{ path: string }>(
      sql`SELECT entity_path::text AS path FROM itil_actors
           WHERE itil_type = 'ticket' AND itil_id = ${ticketId}`,
    );

    return resultat.rows[0]?.path;
  }

  beforeAll(async () => {
    fixture = await createFixture('ACT');
    ticketA = await ticket('Site A', 'siteA');
    ticketB = await ticket('Site B', 'siteB');
  }, 30_000);

  afterAll(async () => {
    await fixture.owner.db.execute(
      sql`DELETE FROM itil_actors WHERE itil_type = 'ticket' AND itil_id IN (${ticketA}, ${ticketB})`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM tickets WHERE name LIKE 'ACT %'`);
    await fixture.cleanup();
  });

  it('hérite du chemin de son ticket sans que l’écriture le nomme', async () => {
    await withRequestContext(fixture.app.db, withSubtree(chemin('siteA')), (tx) =>
      tx.execute(sql`
        INSERT INTO itil_actors (itil_type, itil_id, role, actor_type, actor_id)
        VALUES ('ticket', ${ticketA}, 'requester', 'user', 1)
      `),
    );

    expect(await cheminActeur(ticketA)).toBe(chemin('siteA'));
  });

  it('reste invisible depuis une entité sœur', async () => {
    await fixture.owner.db.execute(sql`
      INSERT INTO itil_actors (itil_type, itil_id, role, actor_type, actor_id)
      VALUES ('ticket', ${ticketB}, 'requester', 'user', 1)
    `);

    const vus = await withRequestContext(fixture.app.db, withSubtree(chemin('siteA')), (tx) =>
      tx.execute(sql`SELECT itil_id FROM itil_actors WHERE itil_id IN (${ticketA}, ${ticketB})`),
    );

    expect(vus.rows.map((ligne) => Number(ligne['itil_id']))).toEqual([ticketA]);
  });

  it('refuse une écriture qui désigne un ticket hors du périmètre', async () => {
    // Le chemin n'est pas fourni par l'écriture : il est déduit du ticket, et un
    // ticket invisible n'en fournit aucun. La ligne ne passe pas le WITH CHECK.
    const tentative = withRequestContext(fixture.app.db, withSubtree(chemin('siteA')), (tx) =>
      tx.execute(sql`
        INSERT INTO itil_actors (itil_type, itil_id, role, actor_type, actor_id)
        VALUES ('ticket', ${ticketB}, 'observer', 'user', 1)
      `),
    );

    await expect(tentative).rejects.toThrow();
  });

  it('suit le déplacement de l’entité du ticket', async () => {
    await withRequestContext(fixture.app.db, withSubtree(chemin('racine')), (tx) =>
      tx.execute(sql`UPDATE entities SET parent_id = ${id('siege')} WHERE id = ${id('siteA')}`),
    );

    const resultat = await fixture.owner.db.execute<{ path: string }>(
      sql`SELECT path::text AS path FROM entities WHERE id = ${id('siteA')}`,
    );
    const nouveau = resultat.rows[0]?.path;

    expect(nouveau?.startsWith(`${chemin('siege')}.`)).toBe(true);
    expect(await cheminActeur(ticketA)).toBe(nouveau);

    // Et le déplacement se voit là où il doit : le ticket suit son entité, donc
    // son acteur n'est plus lisible depuis Filiale Nord.
    const vus = await withRequestContext(fixture.app.db, withSubtree(chemin('nord')), (tx) =>
      tx.execute(sql`SELECT itil_id FROM itil_actors WHERE itil_id = ${ticketA}`),
    );

    expect(vus.rows).toHaveLength(0);

    await fixture.owner.db.execute(
      sql`UPDATE entities SET parent_id = ${id('nord')} WHERE id = ${id('siteA')}`,
    );
  });

  it('ne laisse pas un acteur lisible depuis l’entité seule d’un parent', async () => {
    // `exactly` ne couvre pas la descendance : le ticket de Site A n'est pas
    // dans le périmètre, son acteur non plus.
    const vus = await withRequestContext(fixture.app.db, exactly(chemin('nord')), (tx) =>
      tx.execute(sql`SELECT itil_id FROM itil_actors WHERE itil_id = ${ticketA}`),
    );

    expect(vus.rows).toHaveLength(0);
  });
});
