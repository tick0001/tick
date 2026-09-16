import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withRequestContext, type RequestContext } from '@tick/db';
import { createFixture, exactly, withSubtree, type Fixture } from './fixtures.js';

/**
 * `tick_tickets_semblables`, prise seule.
 *
 * Elle lit l'index en tant que proprietaire, donc **hors** Row-Level Security.
 * Tout le cloisonnement de la recherche textuelle tient a ce qu'elle applique
 * elle-meme le perimetre de l'appelant. La requete de la liste, qui reste sous
 * RLS, repare une fonction qui l'oublierait — si bien que les tests du service
 * resteraient verts. C'est pour cela que la fonction est eprouvee ici, en SQL
 * brut et avec le role applicatif, comme l'appellerait un plugin.
 */
describe('Recherche textuelle : la fonction', () => {
  let fixture: Fixture;
  // Un mot que rien d'autre dans la base ne porte.
  const mot = `quetzal${Date.now().toString(36)}`;
  const ids = { alpha: 0, bravo: 0, charlie: 0 };

  const creer = async (entite: string, titre: string, contenu = ''): Promise<number> => {
    const resultat = await fixture.owner.db.execute<{ id: string }>(sql`
      INSERT INTO tickets (entity_id, entity_path, name, content)
      VALUES (${fixture.entityIds[entite]}, 'temporaire', ${titre}, ${contenu})
      RETURNING id
    `);

    return Number(resultat.rows[0]?.id);
  };

  /** Ce que la fonction rend, appelee avec le role applicatif dans un contexte. */
  const semblables = async (
    contexte: RequestContext,
    motif: string,
    champs: string,
    plafond = 100,
  ): Promise<number[]> => {
    const lignes = await withRequestContext(fixture.app.db, contexte, (tx) =>
      tx.execute<{ id: string }>(sql`
        SELECT s.id FROM tick_tickets_semblables(${motif}, ${champs}, ${plafond}) AS s(id)
      `),
    );

    return lignes.rows.map((ligne) => Number(ligne.id)).sort((a, b) => a - b);
  };

  /** Ce que rend l'`ILIKE` sous Row-Level Security : la reference. */
  const reference = async (contexte: RequestContext, condition: ReturnType<typeof sql>) => {
    const lignes = await withRequestContext(fixture.app.db, contexte, (tx) =>
      tx.execute<{ id: string }>(sql`SELECT id FROM tickets WHERE ${condition}`),
    );

    return lignes.rows.map((ligne) => Number(ligne.id)).sort((a, b) => a - b);
  };

  beforeAll(async () => {
    fixture = await createFixture('RTXT');

    ids.alpha = await creer('siteA', `Serveur ${mot} alpha`);
    ids.bravo = await creer('siteA', 'Poste lent', `Voir le ${mot} du serveur`);
    ids.charlie = await creer('siteB', `Serveur ${mot} charlie`);
  }, 30_000);

  afterAll(async () => {
    await fixture.owner.db.execute(
      sql`DELETE FROM tickets WHERE id IN (${ids.alpha}, ${ids.bravo}, ${ids.charlie})`,
    );
    await fixture.cleanup();
  });

  it('ne rend que ce que le perimetre de l appelant laisse voir', async () => {
    const siteA = exactly(fixture.paths['siteA'] as string);

    expect(await semblables(siteA, `%${mot}%`, 'titre')).toEqual([ids.alpha]);
    expect(await semblables(siteA, `%${mot}%`, 'tous')).toEqual([ids.alpha, ids.bravo]);
  });

  it('suit la descendance quand le perimetre la comprend', async () => {
    const nord = withSubtree(fixture.paths['nord'] as string);

    expect(await semblables(nord, `%${mot}%`, 'titre')).toEqual([ids.alpha, ids.charlie]);
  });

  it('ne rend rien sans contexte, meme a qui detient le role applicatif', async () => {
    // Hors requete, aucun perimetre n'est pose : la fonction ne doit pas en
    // conclure que tout est permis.
    const lignes = await fixture.app.db.execute<{ id: string }>(sql`
      SELECT s.id FROM tick_tickets_semblables(${`%${mot}%`}, 'tous', 100) AS s(id)
    `);

    expect(lignes.rows).toEqual([]);
  });

  it('rend exactement ce que rend l ILIKE sous Row-Level Security', async () => {
    const nord = withSubtree(fixture.paths['nord'] as string);
    const cas: [string, string, ReturnType<typeof sql>][] = [
      [`%${mot}%`, 'titre', sql`name ILIKE ${`%${mot}%`}`],
      [`%${mot.toUpperCase()}%`, 'titre', sql`name ILIKE ${`%${mot.toUpperCase()}%`}`],
      ['Serveur%', 'titre', sql`name ILIKE ${'Serveur%'}`],
      [`%${mot} a%`, 'titre', sql`name ILIKE ${`%${mot} a%`}`],
      [`%${mot}%`, 'description', sql`content ILIKE ${`%${mot}%`}`],
      [`%${mot}%`, 'tous', sql`(name ILIKE ${`%${mot}%`} OR content ILIKE ${`%${mot}%`})`],
    ];

    for (const [motif, champs, condition] of cas) {
      const trouves = await semblables(nord, motif, champs);
      const attendus = (await reference(nord, condition)).filter((id) =>
        [ids.alpha, ids.bravo, ids.charlie].includes(id),
      );

      expect(trouves, `${champs} ${motif}`).toEqual(attendus);
    }
  });

  it('s arrete au plafond', async () => {
    const nord = withSubtree(fixture.paths['nord'] as string);

    expect(await semblables(nord, `%${mot}%`, 'tous', 1)).toHaveLength(1);
  });

  it('refuse une colonne hors de sa liste', async () => {
    const nord = withSubtree(fixture.paths['nord'] as string);

    await expect(semblables(nord, '%x%', 'name; DROP TABLE tickets')).rejects.toThrow();
  });
});
