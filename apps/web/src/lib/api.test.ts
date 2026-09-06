import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

/**
 * La couche d'appel de l'API.
 *
 * Elle est mince par méthode et nombreuse : écrire un test par point d'entrée
 * les ferait diverger, et celui qu'on ajoute demain n'aurait pas le sien. Ce
 * fichier part donc de ce que l'objet `api` expose réellement, si bien qu'une
 * méthode ajoutée est soumise aux mêmes règles sans que personne y pense.
 *
 * Les trois règles vérifiées ne sont pas cosmétiques :
 *
 *  - la session est un cookie `httpOnly`, donc **chaque** appel doit joindre
 *    ses identifiants, sinon le serveur répond 401 sans que rien ne l'explique ;
 *  - tout passe par le préfixe `/api`, que le serveur de développement relaie —
 *    un chemin qui l'oublie tombe sur l'application elle-même et reçoit du HTML ;
 *  - un refus porte son statut, parce qu'un 403 veut dire « votre profil actif
 *    ne le permet pas » et non « une erreur est survenue ».
 */

type Methode = (...args: unknown[]) => unknown;

/**
 * `planningIcalUrl` ne fait aucun appel : elle bâtit l'adresse que le navigateur
 * ouvre lui-même, pour qu'il gère le téléchargement. La récupérer en `fetch`
 * obligerait à reconstruire le fichier en mémoire pour le redonner au disque.
 */
const CONSTRUCTEURS_D_URL = new Set(['planningIcalUrl']);

/**
 * L'enquête de satisfaction se répond **sans session**.
 *
 * Le jeton reçu par courriel fait autorisation, et c'est tout l'intérêt : le
 * demandeur répond sans compte. Y joindre le cookie de session ferait voyager
 * l'identité d'un collègue connecté sur un formulaire public, pour rien.
 */
const SANS_SESSION = new Set(['answerSurvey']);

/**
 * Les exports sont élargis avant d'être filtrés.
 *
 * `Object.entries` produit l'union de tous les types exportés, et un prédicat
 * de type doit être assignable à ce qu'il filtre — ce qu'une union de cette
 * taille n'admet pas. Passer par `unknown` rend le filtre écrivable sans rien
 * affaiblir : ce qui en sort est vérifié à l'exécution, juste en dessous.
 */
const exportes = api as Record<string, unknown>;

const methodes = Object.entries(exportes)
  .filter((entree): entree is [string, Methode] => typeof entree[1] === 'function')
  .filter(([nom]) => !CONSTRUCTEURS_D_URL.has(nom))
  .sort(([a], [b]) => a.localeCompare(b));

/**
 * Jeux d'arguments successifs.
 *
 * Les signatures varient — un identifiant, un filtre, un corps — et le but
 * n'est pas de les reproduire mais de déclencher l'appel réseau. Le premier
 * jeu qui y parvient suffit.
 */
const JEUX: unknown[][] = [
  [1, {}, {}],
  [{ from: '2026-01-01', to: '2026-01-31', dimension: 'status' }, 1, {}],
  ['ticket', 1, {}],
];

function reponseVide(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(''),
    blob: () => Promise.resolve(new Blob()),
  } as unknown as Response;
}

describe('api', () => {
  let fetchSimule: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSimule = vi.fn().mockResolvedValue(reponseVide());
    vi.stubGlobal('fetch', fetchSimule);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('expose au moins cent points d’entrée', () => {
    // Garde-fou : si l'objet cessait d'etre exporte tel quel, ce fichier
    // continuerait de passer en ne verifiant plus rien.
    expect(methodes.length).toBeGreaterThan(100);
  });

  it.each(methodes)('%s passe par /api et joint la session', async (_nom, methode) => {
    for (const jeu of JEUX) {
      fetchSimule.mockClear();

      try {
        await methode(...jeu);
      } catch {
        // Le corps simule ne satisfait aucun schema : le refus de validation
        // est attendu, et sans importance ici. Seul l'appel reseau compte.
      }

      if (fetchSimule.mock.calls.length > 0) break;
    }

    expect(fetchSimule).toHaveBeenCalled();

    const [url, options] = fetchSimule.mock.calls[0] as [string, RequestInit];

    expect(url.startsWith('/api/')).toBe(true);

    if (!SANS_SESSION.has(_nom)) {
      expect(options.credentials).toBe('include');
    }
  });

  it('bâtit l’URL de l’export iCal sans rien appeler', () => {
    const url = api.planningIcalUrl({ from: '2026-01-01', to: '2026-01-31' });

    expect(url).toBe('/api/planning/ical?from=2026-01-01&to=2026-01-31');
    expect(fetchSimule).not.toHaveBeenCalled();
  });

  it('porte les filtres facultatifs de l’export iCal', () => {
    const url = api.planningIcalUrl({
      from: '2026-01-01',
      to: '2026-01-31',
      technicianId: 7,
      groupId: 3,
    });

    expect(url).toContain('technicianId=7');
    expect(url).toContain('groupId=3');
  });
});

describe('ApiError', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reprend le message du serveur', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: 'Cet identifiant est deja utilise.' }),
    } as unknown as Response);

    await expect(api.session()).rejects.toThrowError('Cet identifiant est deja utilise.');
  });

  it('porte le statut, pas seulement le texte', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'Droit manquant.' }),
    } as unknown as Response);

    // Un 403 veut dire « votre profil actif ne le permet pas ». Le confondre
    // avec une panne produit un message qui n'aide personne.
    await expect(api.session()).rejects.toBeInstanceOf(ApiError);
    await expect(api.session()).rejects.toMatchObject({ status: 403, name: 'ApiError' });
  });

  it('se rabat sur le statut quand le corps est illisible', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('pas du JSON')),
    } as unknown as Response);

    // Un relais qui tombe rend du HTML : sans ce repli, l'interface afficherait
    // une erreur d'analyse au lieu du vrai probleme.
    await expect(api.session()).rejects.toThrowError('HTTP 502');
  });

  it('refuse une réponse qui ne respecte pas le contrat', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ inattendu: true }),
    } as unknown as Response);

    // Mieux vaut echouer ici qu'afficher un ecran a moitie vide : une reponse
    // hors contrat signale une API et une interface desynchronisees.
    await expect(api.session()).rejects.toThrow();
  });

  it('n’exige pas de corps sur une écriture sans réponse', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 204 } as unknown as Response);

    await expect(api.logout()).resolves.toBeUndefined();
  });
});
