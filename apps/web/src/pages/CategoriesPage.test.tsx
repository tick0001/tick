import type { ItilCategoryDetail, SessionContext } from '@tick/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { SessionProvider } from '@/lib/session';
import { rendre } from '@/test/rendu';
import { CategoriesPage } from './CategoriesPage';

/**
 * Le référentiel de classement, vu de l'écran.
 *
 * Trois choses s'y jouent, et aucune n'est visible en lisant le composant :
 * ce que le profil a le droit de faire, ce que le formulaire refuse d'envoyer,
 * et quel rattachement il propose. Les deux dernières ne protègent rien — le
 * serveur refuse de toute façon — mais elles évitent de laisser cliquer sur
 * une action dont on sait déjà qu'elle finira en erreur.
 */

const CATEGORIES: ItilCategoryDetail[] = [
  {
    id: 1,
    name: 'Materiel',
    completeName: 'Materiel',
    parentId: null,
    level: 0,
    comment: null,
    isHelpdeskVisible: true,
    forIncident: true,
    forRequest: true,
    forProblem: true,
    forChange: true,
    isRecursive: true,
    entityId: 1,
    entityName: 'DSI',
    childCount: 1,
  },
  {
    id: 2,
    name: 'Impression',
    completeName: 'Materiel > Impression',
    parentId: 1,
    level: 1,
    comment: null,
    isHelpdeskVisible: false,
    forIncident: true,
    forRequest: false,
    forProblem: false,
    forChange: false,
    isRecursive: true,
    entityId: 1,
    entityName: 'DSI',
    childCount: 0,
  },
];

function session(rights: Record<string, string>): SessionContext {
  return {
    user: { id: 1, username: 'admin', displayName: 'Alice Martin', email: null, locale: 'fr' },
    entity: { id: 1, name: 'DSI', completeName: 'DSI', path: 'e1', level: 0, parentId: null },
    profile: { id: 1, name: 'Admin', interface: 'standard' },
    includeSubEntities: true,
    rights,
    available: [],
  } as SessionContext;
}

const TOUS = { 'category:create': 'all', 'category:update': 'all', 'category:delete': 'all' };

function monter(rights: Record<string, string> = TOUS) {
  return rendre(
    <SessionProvider session={session(rights)}>
      <CategoriesPage />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.spyOn(api, 'allItilCategories').mockResolvedValue(CATEGORIES);
});

describe('CategoriesPage', () => {
  it('affiche l’arbre, l’entité et l’applicabilité de chaque ligne', async () => {
    monter();

    expect(await screen.findByText('Materiel')).toBeInTheDocument();
    expect(screen.getByText('Impression')).toBeInTheDocument();

    // Le nombre de filles accompagne la mere : c'est lui qui decide si la
    // suppression est possible.
    expect(screen.getByText('1 sous-catégorie')).toBeInTheDocument();

    // Une categorie que le guichet ne propose pas se signale : sinon on la
    // croit offerte aux demandeurs, et l'on cherche longtemps pourquoi elle
    // n'apparait pas dans leur liste.
    expect(screen.getByText('Interne')).toBeInTheDocument();

    // L'applicabilite ne s'affiche que restreinte : la mere accepte les quatre
    // types, et repeter cette evidence sur chaque ligne noierait la seule
    // information utile -- la restriction de la fille.
    expect(screen.queryByText(/Demandes/)).not.toBeInTheDocument();
    expect(screen.getByText('Incidents')).toBeInTheDocument();
  });

  it('cache la création à qui ne l’a pas, et la suppression de même', async () => {
    monter({ 'category:update': 'all' });

    await screen.findByText('Materiel');

    expect(screen.queryByRole('button', { name: /nouvelle catégorie/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();

    // Modifier reste offert : c'est le droit qui a ouvert l'ecran.
    expect(screen.getAllByRole('button', { name: 'Modifier' })).toHaveLength(2);
  });

  it('ne propose pas une catégorie comme parent d’elle-même ni de sa mère', async () => {
    const utilisateur = userEvent.setup();

    monter();
    await screen.findByText('Materiel');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    const parent = await screen.findByLabelText('Rattachée à');
    const options = within(parent)
      .getAllByRole('option')
      .map((option) => option.textContent);

    // S'y rattacher, ou se rattacher a sa fille, fermerait l'arbre sur
    // lui-meme : le declencheur qui recalcule les chemins tournerait sans fin.
    expect(options).toEqual(['Aucune — catégorie racine']);
  });

  it('refuse d’envoyer une catégorie qui ne s’applique à rien', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveItilCategory');

    monter();
    await screen.findByText('Materiel');

    await utilisateur.click(screen.getByRole('button', { name: /nouvelle catégorie/i }));
    await utilisateur.type(await screen.findByLabelText('Nom'), 'Reseau');

    // `fireEvent` et non `userEvent` : la case est enveloppee dans son
    // `<label>`, et happy-dom rejoue alors l'activation de l'etiquette par
    // dessus le clic sur l'entree -- deux bascules, donc aucune.
    for (const type of ['Incidents', 'Demandes', 'Problèmes', 'Changements']) {
      fireEvent.click(screen.getByRole('checkbox', { name: type }));
    }

    expect(screen.getByText('Choisissez au moins un type.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it('crée une catégorie racine et referme le formulaire', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi
      .spyOn(api, 'saveItilCategory')
      .mockResolvedValue({ ...CATEGORIES[0]!, id: 3, name: 'Reseau', completeName: 'Reseau' });

    monter();
    await screen.findByText('Materiel');

    await utilisateur.click(screen.getByRole('button', { name: /nouvelle catégorie/i }));
    await utilisateur.type(await screen.findByLabelText('Nom'), 'Reseau');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Reseau', parentId: null, isHelpdeskVisible: true }),
        undefined,
      );
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument();
    });
  });

  it('reprend les valeurs existantes à la modification et renvoie l’identifiant', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveItilCategory').mockResolvedValue(CATEGORIES[1]!);

    monter();
    await screen.findByText('Impression');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[1]!);

    expect(await screen.findByLabelText('Nom')).toHaveValue('Impression');
    expect(screen.getByRole('checkbox', { name: /Proposée au guichet/ })).not.toBeChecked();

    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Impression', parentId: 1, forRequest: false }),
        2,
      );
    });
  });

  it('demande confirmation avant de supprimer, et s’abstient si l’on refuse', async () => {
    const utilisateur = userEvent.setup();
    const supprimer = vi.spyOn(api, 'deleteItilCategory').mockResolvedValue();
    const confirmer = vi.fn().mockReturnValue(false);

    vi.stubGlobal('confirm', confirmer);

    monter();
    await screen.findByText('Impression');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Supprimer' })[1]!);

    expect(confirmer).toHaveBeenCalled();
    expect(supprimer).not.toHaveBeenCalled();

    confirmer.mockReturnValue(true);
    await utilisateur.click(screen.getAllByRole('button', { name: 'Supprimer' })[1]!);

    await waitFor(() => {
      expect(supprimer).toHaveBeenCalledWith(2);
    });
  });

  it('montre le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    vi.spyOn(api, 'deleteItilCategory').mockRejectedValue(
      new Error('Cette categorie a des sous-categories : retirez-les d abord.'),
    );

    monter();
    await screen.findByText('Materiel');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]!);

    expect(await screen.findByText(/sous-categories/)).toBeInTheDocument();
  });
});
