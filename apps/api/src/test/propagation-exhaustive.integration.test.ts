import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@tick/db';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * La propagation d'un déplacement atteint-elle **toutes** les tables ?
 *
 * Elle a cessé de le faire une fois, et sans bruit : en réécrivant
 * `entities_propagate_path()` pour y ajouter les acteurs, le corps a été repris
 * d'une migration antérieure, et la liste des cibles est retombée de trente-cinq
 * tables à quinze. Les problèmes, les changements, les engagements, les règles,
 * la base de connaissances et les formulaires gardaient l'ancien chemin — donc
 * visibles depuis la branche d'origine, invisibles depuis la nouvelle.
 *
 * Le test de déplacement existant ne l'a pas vu : il déplace un groupe et une
 * catégorie, deux tables restées dans la liste. Une vérification par échantillon
 * ne prouve rien sur une liste écrite à la main.
 *
 * Ces deux tests-ci ne portent donc pas sur des tables choisies. Le premier
 * interroge le catalogue et exige que la fonction couvre tout ce qui porte un
 * chemin ; le second vérifie l'invariant sur la base entière après un
 * déplacement réel. La liste est maintenant dérivée du catalogue, ce qui rend
 * la faute impossible — ces tests sont le filet si quelqu'un revenait à une
 * énumération.
 */
describe('Exhaustivité de la propagation des chemins', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('PROP');
  }, 30_000);

  afterAll(async () => {
    for (const table of ['problems', 'dashboards', 'agreements', 'rules']) {
      await fixture.owner.db.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE name LIKE ${'PROP %'}`,
      );
    }
    await fixture.cleanup();
  });

  const id = (cle: string) => fixture.entityIds[cle] as number;

  /** Tables soumises à la propagation, telles que le catalogue les définit. */
  const TABLES_A_CHEMIN = sql`
    SELECT c.relname AS table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relkind = 'r' AND c.relname <> 'entities'
     GROUP BY c.relname
    HAVING bool_or(a.attname = 'entity_id') AND bool_or(a.attname = 'entity_path')
     ORDER BY c.relname`;

  it('couvre chaque table qui porte un chemin d’entité', async () => {
    const attendues = await fixture.owner.db.execute<{ table: string }>(TABLES_A_CHEMIN);
    const noms = attendues.rows.map((ligne) => ligne.table);

    // Garde-fou : si la requête ne rendait rien, le test passerait sans rien
    // vérifier. Trente-cinq tables au moment où il est écrit.
    expect(noms.length).toBeGreaterThanOrEqual(35);
    expect(noms).toContain('problems');
    expect(noms).toContain('dashboards');
    expect(noms).not.toContain('authorizations');

    const [fonction] = (
      await fixture.owner.db.execute<{ corps: string }>(
        sql`SELECT prosrc AS corps FROM pg_proc WHERE proname = 'entities_propagate_path'`,
      )
    ).rows;

    expect(fonction?.corps).toBeDefined();

    // Une liste écrite à la main se désynchronise ; celle-ci se déduit. Si
    // quelqu'un revient à une énumération, chaque table doit y figurer.
    const corps = fonction?.corps ?? '';
    const enumere = corps.includes('FOREACH cible IN ARRAY');

    if (enumere) {
      for (const nom of noms) {
        expect(corps, `${nom} absente de la liste énumérée`).toContain(`'${nom}'`);
      }
    }
  });

  it('ne laisse aucun chemin périmé après un déplacement', async () => {
    const entite = id('siteA');

    for (const table of ['problems', 'dashboards']) {
      await fixture.owner.db.execute(sql`
        INSERT INTO ${sql.raw(table)} (name, entity_id, entity_path)
        VALUES (${'PROP ' + table}, ${entite}, 'temporaire')
      `);
    }
    await fixture.owner.db.execute(sql`
      INSERT INTO agreements (name, entity_id, entity_path, duration)
      VALUES ('PROP agreements', ${entite}, 'temporaire', 3600)
    `);
    await fixture.owner.db.execute(sql`
      INSERT INTO rules (name, entity_id, entity_path, collection)
      VALUES ('PROP rules', ${entite}, 'temporaire', 'ticket.create')
    `);

    await fixture.owner.db.execute(
      sql`UPDATE entities SET parent_id = ${id('siege')} WHERE id = ${entite}`,
    );

    // L'invariant, vérifié sur la base entière et non sur les quatre lignes
    // qu'on vient d'écrire : aucune table ne doit contenir de ligne dont le
    // chemin diffère de celui de son entité. `query_to_xml` exécute le compte
    // sur chaque table sans qu'aucune soit nommée ici — c'est ce qui fait tenir
    // le test le jour où une table s'ajoute.
    const perimes = await fixture.owner.db.execute<{ table: string; lignes: string }>(sql`
      SELECT t.table,
             (xpath('/row/n/text()', query_to_xml(format(
                'SELECT count(*) AS n FROM %I x JOIN entities e ON e.id = x.entity_id
                  WHERE x.entity_path IS DISTINCT FROM e.path', t.table),
                false, true, '')))[1]::text::bigint AS lignes
        FROM (${TABLES_A_CHEMIN}) t`);

    const fautives = perimes.rows.filter((ligne) => Number(ligne.lignes) > 0);

    expect(perimes.rows.length).toBeGreaterThanOrEqual(35);
    expect(fautives.map((ligne) => `${ligne.table} (${ligne.lignes})`)).toEqual([]);

    // Et les acteurs, qui n'ont pas d'entité propre : leur chemin est celui de
    // leur objet.
    const acteurs = await fixture.owner.db.execute<{ lignes: string }>(sql`
      SELECT count(*) AS lignes
        FROM itil_actors a
        JOIN tickets t ON a.itil_type = 'ticket' AND a.itil_id = t.id
       WHERE a.entity_path IS DISTINCT FROM t.entity_path`);

    expect(Number(acteurs.rows[0]?.lignes ?? 0)).toBe(0);
  });
});
