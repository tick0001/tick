import { types } from 'pg';
import { describe, expect, it } from 'vitest';
import { createDatabase, schema } from './client.js';

/**
 * L'analyseur des entiers 64 bits, installé par effet de bord à l'import.
 *
 * `node-postgres` rend les `bigint` en chaînes pour ne rien perdre au-delà de
 * 2^53. Le comportement est correct mais traître : une requête typée par
 * Drizzle renvoie un nombre, la même requête en SQL brut renvoie une chaîne, et
 * `id === row.id` est faux sans que rien ne le signale.
 */
describe('Analyseur INT8', () => {
  const analyse = types.getTypeParser(types.builtins.INT8) as (valeur: string) => number;

  it('rend un nombre, pas une chaine', () => {
    expect(analyse('42')).toBe(42);
    expect(typeof analyse('42')).toBe('number');
  });

  it('couvre la plage des identites reelles', () => {
    expect(analyse('1')).toBe(1);
    expect(analyse('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('lit les valeurs negatives', () => {
    expect(analyse('-7')).toBe(-7);
  });

  /**
   * Au-delà du seuil, le refus est explicite.
   *
   * `Number('9007199254740993')` rend 9007199254740992 sans broncher : deux
   * lignes distinctes porteraient alors le même identifiant côté application.
   * Mieux vaut une erreur qu'une confusion silencieuse.
   */
  it('refuse plutot que de perdre en precision', () => {
    expect(() => analyse('9007199254740993')).toThrowError(/hors de la plage representable/);
    expect(() => analyse('99999999999999999999')).toThrowError(/hors de la plage representable/);
  });
});

describe('createDatabase', () => {
  // Le pool de `pg` est paresseux : il n'ouvre une connexion qu'a la premiere
  // requete. On peut donc verifier le montage sans base disponible.
  const options = { connectionString: 'postgres://absent:absent@127.0.0.1:1/absent' };

  it('rend une base et sa fermeture', async () => {
    const connexion = createDatabase(options);

    expect(connexion.db).toBeDefined();
    expect(typeof connexion.db.select).toBe('function');
    expect(typeof connexion.db.transaction).toBe('function');

    await expect(connexion.close()).resolves.toBeUndefined();
  });

  it('expose le schema au constructeur de requetes relationnel', () => {
    const connexion = createDatabase(options);

    // Sans le schema passe a `drizzle`, `db.query` est vide et tout `with:`
    // echoue a l'execution seulement.
    expect(connexion.db.query.tickets).toBeDefined();
    expect(connexion.db.query.entities).toBeDefined();

    void connexion.close();
  });

  it('reexporte le schema', () => {
    expect(schema.tickets).toBeDefined();
    expect(schema.entities).toBeDefined();
  });

  it('n’expose pas le pool, pour que personne n’en depende', () => {
    const connexion = createDatabase(options);

    expect(Object.keys(connexion).sort()).toEqual(['close', 'db']);

    void connexion.close();
  });
});
