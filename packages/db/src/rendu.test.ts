import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { rendreSql } from './rendu.js';

/**
 * Le rendu paramétré.
 *
 * Ce qu'il garantit tient en une phrase : les valeurs ne se retrouvent jamais
 * dans le texte. C'est ce qui permet aux tests du moteur de recherche de
 * vérifier qu'une saisie hostile reste une donnée, et non un morceau de
 * requête.
 */

describe('rendreSql', () => {
  it('sépare le texte de ses valeurs', () => {
    const { texte, parametres } = rendreSql(sql`urgency = ${3}`);

    expect(texte).toBe('urgency = $1');
    expect(parametres).toEqual([3]);
  });

  it('numérote les marqueurs dans l’ordre', () => {
    const { texte, parametres } = rendreSql(sql`a = ${1} AND b = ${'deux'}`);

    expect(texte).toBe('a = $1 AND b = $2');
    expect(parametres).toEqual([1, 'deux']);
  });

  it('laisse une valeur hostile hors du texte', () => {
    const hostile = "'; DROP TABLE tickets; --";
    const { texte, parametres } = rendreSql(sql`name = ${hostile}`);

    // C'est toute la raison d'etre de ce rendu : sans parametre lie, cette
    // chaine ferait partie de la requete.
    expect(texte).not.toContain('DROP');
    expect(parametres).toEqual([hostile]);
  });

  it('rend le SQL brut tel quel, puisqu’il vient du code', () => {
    const { texte, parametres } = rendreSql(sql`${sql.raw('t.name')} IS NOT NULL`);

    expect(texte).toBe('t.name IS NOT NULL');
    expect(parametres).toEqual([]);
  });
});
