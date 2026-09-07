import type { SatisfactionConfig, SatisfactionStats } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, sessionFactice, tousDroits } from '@/test/page';
import { SurveysPage } from './SurveysPage';

/**
 * Enquêtes de satisfaction.
 *
 * L'écran fait deux choses à la fois, et la confusion serait coûteuse : il
 * **règle** l'entité active, mais il **lit** les résultats de tout le
 * périmètre. Modifier un taux en croyant régler la branche entière, ou lire
 * une moyenne en croyant qu'elle ne couvre que l'entité courante, mènent aux
 * deux erreurs opposées.
 *
 * D'où la règle testée ici : la configuration affichée est celle de l'entité
 * active, et changer de contexte doit recharger le formulaire — sinon on
 * enregistre sur la mauvaise entité sans jamais s'en rendre compte.
 */

const CONFIGS: SatisfactionConfig[] = [
  {
    id: 1,
    entityId: 1,
    entityName: 'Racine',
    isRecursive: true,
    isActive: true,
    // 35 et non 30 : le defaut du formulaire vaut 30, et une valeur identique
    // rendrait le garde de chargement aveugle.
    percentage: 35,
    delayDays: 1,
    durationDays: 30,
    reminderDays: 7,
  },
  {
    id: 2,
    entityId: 2,
    entityName: 'DSI',
    isRecursive: false,
    isActive: false,
    percentage: 80,
    delayDays: 2,
    durationDays: 15,
    reminderDays: null,
  },
];

const STATS: SatisfactionStats = {
  requested: 120,
  answered: 44,
  averageRating: 4.1,
  distribution: [
    { rating: 4, count: 20 },
    { rating: 5, count: 24 },
  ],
};

const DROITS = tousDroits(['satisfaction']);

/**
 * Attend que la configuration chargée ait remplacé les défauts.
 *
 * Le formulaire s'affiche avant la réponse du serveur, avec les valeurs par
 * défaut : agir tout de suite reviendrait à vérifier ces défauts, et le test
 * passerait quelle que soit la réponse.
 *
 * Le taux attendu doit donc **différer du défaut**, sans quoi le garde se
 * satisfait de l'état initial et ne garde rien.
 */
async function attendreChargement(taux: number): Promise<HTMLElement> {
  const champ = await screen.findByLabelText(/Part des tickets clos/);

  await waitFor(() => {
    expect(champ).toHaveValue(taux);
  });

  return champ;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'satisfactionConfigs').mockResolvedValue(CONFIGS);
  vi.spyOn(api, 'satisfactionStats').mockResolvedValue(STATS);
});

describe('SurveysPage', () => {
  it('affiche la configuration de l’entité active, et non d’une autre', async () => {
    monterPage(<SurveysPage session={sessionFactice(DROITS)} />, { droits: DROITS });

    // L'entite active est la racine : c'est son taux de 30 % qui s'affiche, et
    // non les 80 % de la DSI qui figurent pourtant dans la meme reponse.
    await attendreChargement(35);

    expect(screen.getByLabelText(/Relance après/)).toHaveValue(7);
    expect(screen.getByLabelText(/Validité du lien/)).toHaveValue(30);
  });

  it('recharge le formulaire quand le contexte change d’entité', async () => {
    const dsi = sessionFactice(DROITS, {
      entity: {
        id: 2,
        name: 'DSI',
        completeName: 'Racine > DSI',
        path: 'e1.e2',
        level: 1,
        parentId: 1,
      },
    });

    monterPage(<SurveysPage session={dsi} />, { droits: DROITS });

    // Sinon on modifierait la mauvaise entite : le formulaire montrerait les
    // valeurs de la racine tout en enregistrant sur la DSI.
    await attendreChargement(80);

    // Sans configuration propre, la DSI n'a pas de relance : le champ reste
    // vide plutot que de reprendre les 7 jours de la racine.
    expect(screen.getByLabelText(/Relance après/)).toHaveValue(null);
  });

  it('retombe sur les défauts quand l’entité n’a pas de configuration propre', async () => {
    const autre = sessionFactice(DROITS, {
      entity: {
        id: 9,
        name: 'RH',
        completeName: 'Racine > RH',
        path: 'e1.e9',
        level: 1,
        parentId: 1,
      },
    });

    monterPage(<SurveysPage session={autre} />, { droits: DROITS });

    // Ici le garde ne peut pas s'appuyer sur le taux, qui vaut justement le
    // defaut : on attend que les resultats soient peints, ce qui atteste que
    // les deux requetes ont repondu.
    await screen.findByText('120');

    // Aucune configuration posee ici : le formulaire part des defauts plutot
    // que de reprendre les 35 % de la racine ou les 80 % de la DSI.
    expect(screen.getByLabelText(/Part des tickets clos/)).toHaveValue(30);
    expect(screen.getByLabelText(/Relance après/)).toHaveValue(null);
  });

  it('lit les résultats de tout le périmètre', async () => {
    monterPage(<SurveysPage session={sessionFactice(DROITS)} />, { droits: DROITS });

    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('44')).toBeInTheDocument();

    // La moyenne couvre le perimetre entier, pas la seule entite reglee : les
    // confondre ferait tirer des conclusions sur la mauvaise population.
    expect(screen.getByText(/4[.,]1/)).toBeInTheDocument();
  });

  it('enregistre le paramétrage de l’entité active', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveSatisfactionConfig').mockResolvedValue(CONFIGS[0]!);

    monterPage(<SurveysPage session={sessionFactice(DROITS)} />, { droits: DROITS });

    const taux = await attendreChargement(35);

    await utilisateur.clear(taux);
    await utilisateur.type(taux, '50');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(expect.objectContaining({ percentage: 50 }));
    });
  });

  it('cache l’enregistrement à qui n’a pas le droit d’écrire', async () => {
    const lecture = sessionFactice({ 'satisfaction:read': 'all' });

    monterPage(<SurveysPage session={lecture} />, { droits: { 'satisfaction:read': 'all' } });

    await attendreChargement(35);

    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveSatisfactionConfig').mockRejectedValue(
      new ApiError(400, 'Taux hors bornes.'),
    );

    monterPage(<SurveysPage session={sessionFactice(DROITS)} />, { droits: DROITS });

    const taux = await attendreChargement(35);

    await utilisateur.clear(taux);
    await utilisateur.type(taux, '40');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Taux hors bornes.')).toBeInTheDocument();
  });
});
