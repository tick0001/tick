import { describe, expect, it } from 'vitest';
import { toLtreeArrayLiteral } from './context.js';

describe('toLtreeArrayLiteral', () => {
  it('assemble un litteral de tableau PostgreSQL', () => {
    expect(toLtreeArrayLiteral(['e1', 'e1.e3.e4'])).toBe('{e1,e1.e3.e4}');
  });

  it('produit un tableau vide sans chemin', () => {
    expect(toLtreeArrayLiteral([])).toBe('{}');
  });

  it.each([
    ['e1,e2', 'une virgule scinderait le litteral en deux elements'],
    ['e1}', 'une accolade fermerait le litteral prematurement'],
    ['e1 e2', "une etiquette ltree ne contient pas d'espace"],
    ["e1'", 'un apostrophe casserait la valeur transmise'],
    ['', 'un chemin vide ne designe aucune entite'],
  ])('refuse le chemin %j', (chemin) => {
    // Les chemins passent par un parametre lie, mais ils sont concatenes entre
    // eux avant : une valeur malformee produirait sinon un perimetre errone,
    // ce qui est un defaut de securite et non un simple bug de format.
    expect(() => toLtreeArrayLiteral([chemin])).toThrowError(/Chemin d'entite invalide/);
  });
});
