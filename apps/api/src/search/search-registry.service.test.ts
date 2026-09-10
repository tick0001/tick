import { rendreSql } from '@tick/db';
import { describe, expect, it } from 'vitest';
import { SearchRegistry } from './search-registry.service.js';

/**
 * Le registre des champs interrogeables.
 *
 * Une entrée du registre n'est pas seulement une déclaration : c'est le
 * fragment de SQL que toute recherche sur ce champ exécutera. Une expression
 * maladroite ici ne casse rien — elle ralentit tout, silencieusement, et ne se
 * voit qu'à la volumétrie.
 */
describe('SearchRegistry', () => {
  const registre = new SearchRegistry();

  /**
   * **Une colonne ne se caste pas.**
   *
   * `tickets.status::text = 'new'` interdit au planificateur d'utiliser le
   * moindre index : il balaie la table puis trie. À cinq cent mille tickets, la
   * recherche par statut coûtait 325 ms de balayage là où la comparaison
   * directe lit l'index en 1,9 ms — et 406 ms de bout en bout contre 22.
   *
   * Le cast ne protégeait de rien : le compilateur refuse déjà toute valeur
   * hors des `options` déclarées, et une valeur invalide n'atteint jamais SQL.
   *
   * Ce test porte sur la **colonne**, pas sur la valeur : caster la valeur est
   * légitime, c'est caster ce qui est indexé qui ruine la lecture.
   */
  it('ne caste aucune colonne, sous peine de rendre les index inutilisables', () => {
    const fautifs = registre
      .list()
      .map((champ) => ({ key: champ.key, sql: rendreSql(champ.column).texte }))
      // Une sous-requête a le droit de caster ce qu'elle rend : elle n'est pas
      // le terme indexé de la comparaison.
      .filter((champ) => !champ.sql.includes('SELECT'))
      .filter((champ) => champ.sql.includes('::'));

    expect(fautifs).toEqual([]);
  });

  /** Un champ déclaré `enum` sans ses choix laisserait passer n'importe quoi. */
  it('annonce les choix de chaque champ a valeurs fermees', () => {
    const sansChoix = registre
      .list()
      .filter((champ) => champ.type === 'enum')
      .filter((champ) => !champ.options || champ.options.length === 0)
      .map((champ) => champ.key);

    expect(sansChoix).toEqual([]);
  });
});
