import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Database, Transaction } from './client.js';
import { toLtreeArrayLiteral, withRequestContext, type RequestContext } from './context.js';

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

/**
 * L'injection du contexte dans la transaction.
 *
 * Le contexte n'est jamais passé en argument aux requêtes métier : il vit dans
 * les paramètres de la transaction PostgreSQL, que lisent les politiques de
 * Row-Level Security. Une injection manquée ne fait pas échouer la requête —
 * elle la fait répondre depuis un périmètre vide, ou depuis tous les
 * périmètres. Le détail ci-dessous est donc du ressort de la sécurité.
 */
describe('withRequestContext', () => {
  const contexte: RequestContext = {
    userId: 7,
    profileId: 2,
    entityPath: 'racine.nord',
    scope: { subtreePaths: ['racine.nord'], exactPaths: ['racine'] },
  };

  /** Base factice : la transaction se contente d'exécuter le travail demandé. */
  function baseFactice(): {
    db: Database;
    execute: Mock<(requete: unknown) => Promise<undefined>>;
  } {
    const execute = vi.fn<(requete: unknown) => Promise<undefined>>().mockResolvedValue(undefined);
    const tx = { execute } as unknown as Transaction;
    const db = {
      transaction: (travail: (tx: Transaction) => Promise<unknown>) => travail(tx),
    } as unknown as Database;

    return { db, execute };
  }

  it('rend ce que le travail a produit', async () => {
    const { db } = baseFactice();

    await expect(withRequestContext(db, contexte, () => Promise.resolve('resultat'))).resolves.toBe(
      'resultat',
    );
  });

  it('pose le contexte avant d’executer le travail', async () => {
    const { db, execute } = baseFactice();
    const traces: string[] = [];

    execute.mockImplementation(() => {
      traces.push('contexte');

      return Promise.resolve(undefined);
    });

    await withRequestContext(db, contexte, () => {
      traces.push('travail');

      return Promise.resolve(undefined);
    });

    // L'ordre est la garantie : une requete lancee avant `set_config` verrait
    // un perimetre vide et ne ramenerait rien, sans erreur.
    expect(traces).toEqual(['contexte', 'travail']);
  });

  it('transmet les cinq parametres attendus', async () => {
    const { db, execute } = baseFactice();

    await withRequestContext(db, contexte, () => Promise.resolve(undefined));

    expect(execute).toHaveBeenCalledTimes(1);

    const requete = execute.mock.calls[0]?.[0] as { queryChunks: unknown[] };
    const texte = JSON.stringify(requete);

    for (const parametre of [
      'tick.user_id',
      'tick.profile_id',
      'tick.entity_path',
      'tick.scope_paths',
      'tick.exact_paths',
    ]) {
      expect(texte).toContain(parametre);
    }
  });

  it('lie les valeurs plutot que de les concatener', async () => {
    const { db, execute } = baseFactice();

    await withRequestContext(db, contexte, () => Promise.resolve(undefined));

    const requete = execute.mock.calls[0]?.[0] as { queryChunks: unknown[] };
    const parametres = JSON.stringify(requete);

    // Les identifiants passent en chaines : `set_config` n'accepte que du texte,
    // et un entier non converti ferait echouer la transaction entiere.
    expect(parametres).toContain('"7"');
    expect(parametres).toContain('"2"');
    expect(parametres).toContain('racine.nord');
    expect(parametres).toContain('{racine.nord}');
    expect(parametres).toContain('{racine}');
  });

  it('limite les parametres a la transaction', async () => {
    const { db, execute } = baseFactice();

    await withRequestContext(db, contexte, () => Promise.resolve(undefined));

    const requete = JSON.stringify(execute.mock.calls[0]?.[0]);

    // Le troisieme argument de `set_config` vaut `true` : sans lui, une
    // connexion rendue au pool garderait le perimetre de l'utilisateur
    // precedent, et le suivant lirait ses lignes.
    expect(requete).toContain('true');
    expect(requete).not.toContain(', false)');
  });

  it('refuse un perimetre malforme sans rien executer', async () => {
    const { db, execute } = baseFactice();
    const travail = vi.fn();

    await expect(
      withRequestContext(
        db,
        { ...contexte, scope: { subtreePaths: ["racine'; DROP"], exactPaths: [] } },
        travail,
      ),
    ).rejects.toThrowError(/Chemin d'entite invalide/);

    expect(execute).not.toHaveBeenCalled();
    expect(travail).not.toHaveBeenCalled();
  });

  it('laisse remonter l’echec du travail', async () => {
    const { db } = baseFactice();

    await expect(
      withRequestContext(db, contexte, () => Promise.reject(new Error('echec metier'))),
    ).rejects.toThrowError('echec metier');
  });

  it('accepte un perimetre vide', async () => {
    const { db, execute } = baseFactice();

    await withRequestContext(db, { ...contexte, scope: { subtreePaths: [], exactPaths: [] } }, () =>
      Promise.resolve(undefined),
    );

    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain('{}');
  });
});
