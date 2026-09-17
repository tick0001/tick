import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withRequestContext } from '@tick/db';
import { createFixture, withSubtree, type Fixture } from './fixtures.js';

/**
 * La compilation JIT, coupée pour le trafic applicatif.
 *
 * Sous Row-Level Security, le planificateur surestime le coût des requêtes, et
 * au-delà de `jit_above_cost` PostgreSQL compile chaque requête avant de la
 * jouer. Mesuré sur la recherche de la base de connaissances, à dix mille
 * articles : 800 ms par requête avec la JIT, 50 ms sans.
 */

/** Assez coûteuse, à l'estimation, pour déclencher la JIT là où elle est active. */
const REQUETE_COUTEUSE = sql`
  EXPLAIN (FORMAT JSON)
  SELECT count(*) FROM generate_series(1, 20000000) AS g WHERE g % 7 = 3
`;

type Plan = { 'QUERY PLAN': [Record<string, unknown>] } & Record<string, unknown>;

describe('Compilation JIT', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('JIT');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  const contexte = () => withSubtree(fixture.paths['racine'] as string);

  it('est coupée dans une transaction applicative', async () => {
    const valeur = await withRequestContext(fixture.app.db, contexte(), async (tx) => {
      const resultat = await tx.execute<{ jit: string }>(sql`SELECT current_setting('jit') AS jit`);

      return resultat.rows[0]?.jit;
    });

    expect(valeur).toBe('off');
  });

  it('ne compile pas une requête que le planificateur croit coûteuse', async () => {
    const plan = await withRequestContext(fixture.app.db, contexte(), async (tx) => {
      const resultat = await tx.execute<Plan>(REQUETE_COUTEUSE);

      return resultat.rows[0]?.['QUERY PLAN'][0];
    });

    expect(plan).toBeDefined();
    expect(plan).not.toHaveProperty('JIT');
  });

  it('ne survit pas à la transaction', async () => {
    await withRequestContext(fixture.app.db, contexte(), () => Promise.resolve(undefined));

    // Réglage local : la connexion rendue au pool retrouve la configuration
    // du serveur, que d'autres usages de la base peuvent attendre.
    const resultat = await fixture.app.db.execute<{ jit: string; defaut: string }>(
      sql`SELECT current_setting('jit') AS jit, reset_val AS defaut
            FROM pg_settings WHERE name = 'jit'`,
    );

    expect(resultat.rows[0]?.jit).toBe(resultat.rows[0]?.defaut);
  });

  it('est bien ce qui retirait la compilation, là où la JIT est disponible', async () => {
    const disponible = await fixture.app.db.execute<{ oui: boolean }>(
      sql`SELECT pg_jit_available() AS oui`,
    );

    // Témoin : sans la coupure, la même requête est compilée. Il ne prouve
    // quelque chose que sur un serveur construit avec LLVM, ce qui est le cas
    // de l'image officielle utilisée en développement et en intégration.
    if (!disponible.rows[0]?.oui) return;

    const plan = await fixture.app.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL jit = on`);
      const resultat = await tx.execute<Plan>(REQUETE_COUTEUSE);

      return resultat.rows[0]?.['QUERY PLAN'][0];
    });

    expect(plan).toHaveProperty('JIT');
  });
});
