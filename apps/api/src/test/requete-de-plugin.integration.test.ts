import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, sql, type Connection } from '@tick/db';
import { requeteDePlugin } from '../plugins/requete-de-plugin.js';

/**
 * Les requêtes des plugins, sur un serveur réglé contre elles.
 *
 * `standard_conforming_strings` désactivé, PostgreSQL lit la barre oblique
 * inverse comme un échappement dans toute chaîne littérale. Une valeur échappée
 * à la main en doublant les apostrophes n'y résiste pas : `x\'` ferme la
 * chaîne, et la suite devient du SQL. Des paramètres liés n'ont pas ce
 * problème, puisque la valeur ne passe jamais par le texte de la requête.
 */
describe('Requêtes de plugin', () => {
  let base: Connection;

  /** Une valeur qui referme la chaîne si elle est recopiée dans le texte. */
  const PIEGE = String.raw`x\' OR true --`;

  beforeAll(() => {
    const url = new URL(process.env['DATABASE_URL'] as string);

    url.searchParams.set('options', '-c standard_conforming_strings=off');
    base = createDatabase({ connectionString: url.toString(), max: 1 });
  });

  afterAll(async () => {
    await base.close();
  });

  const executer = async (requete: ReturnType<typeof requeteDePlugin>) =>
    (await base.db.execute<Record<string, unknown>>(requete)).rows;

  it('tourne bien sur un serveur hostile', async () => {
    const lignes = await executer(sql`SHOW standard_conforming_strings`);

    expect(lignes[0]).toEqual({ standard_conforming_strings: 'off' });
  });

  it('rend la valeur telle quelle, sans jamais l’interpréter', async () => {
    const lignes = await executer(requeteDePlugin('SELECT $1::text AS v', [PIEGE]));

    expect(lignes).toEqual([{ v: PIEGE }]);
  });

  it('tombait dans le piège quand la valeur était recopiée dans le texte', async () => {
    // Témoin : l'ancien échappement, qui doublait les apostrophes. La valeur
    // y ferme la chaîne et devient du SQL : la requête échoue, ou rend autre
    // chose que ce qu'on lui a donné.
    const recopiee = `'${PIEGE.replaceAll("'", "''")}'`;
    const resultat = await executer(sql.raw(`SELECT ${recopiee}::text AS v`)).catch(
      (erreur: unknown) => erreur,
    );

    expect(resultat).not.toEqual([{ v: PIEGE }]);
  });

  it('réutilise un même paramètre', async () => {
    const lignes = await executer(requeteDePlugin('SELECT $1::int + $1::int AS somme', [21]));

    expect(lignes).toEqual([{ somme: 42 }]);
  });

  it('passe un tableau comme un tableau PostgreSQL', async () => {
    const lignes = await executer(
      requeteDePlugin('SELECT 2 = ANY($1::int[]) AS present, cardinality($1::int[]) AS n', [
        [1, 2, 3],
      ]),
    );

    expect(lignes).toEqual([{ present: true, n: 3 }]);
  });

  it('passe les dates, les booléens et l’absence de valeur', async () => {
    const date = new Date('2026-09-17T10:00:00Z');
    const lignes = await executer(
      requeteDePlugin(
        'SELECT $1::timestamptz AS quand, $2::boolean AS drapeau, $3::text IS NULL AS vide',
        [date, false, undefined],
      ),
    );

    // Le client de la base rend les horodatages en texte : on compare l'instant.
    expect(new Date(String(lignes[0]?.['quand'])).toISOString()).toBe(date.toISOString());
    expect(lignes[0]).toMatchObject({ drapeau: false, vide: true });
  });

  it('refuse un paramètre cité mais absent', () => {
    expect(() => requeteDePlugin('SELECT $1, $2', ['seul'])).toThrow(/\$2.*1 parametre/);
  });

  it('refuse un objet, que le plugin doit sérialiser lui-même', () => {
    expect(() => requeteDePlugin('SELECT $1', [{ a: 1 }])).toThrow(/serialise/);
    expect(() => requeteDePlugin('SELECT $1', [[1, { a: 1 }]])).toThrow(/tableau mixte/);
  });

  it('laisse intact un texte sans paramètre', async () => {
    const lignes = await executer(requeteDePlugin("SELECT 'sans $ ni rien' AS v", []));

    expect(lignes).toEqual([{ v: 'sans $ ni rien' }]);
  });
});
