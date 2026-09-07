import type { SavedSearch, SearchField, TicketPage } from '@tick/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { SearchPage } from './SearchPage';

/**
 * Recherche multi-critères et actions massives.
 *
 * Deux comportements y méritent une garde, et aucun ne se voit dans le rendu.
 *
 * D'abord la **sélection**, qui ne survit pas à une nouvelle recherche :
 * garder des identifiants qui ne sont plus à l'écran ferait agir sur des
 * tickets qu'on ne voit pas — et une action massive ne se rattrape pas.
 *
 * Ensuite la **valeur** d'une action massive, dont le type dépend de l'action
 * choisie : `setUrgency` attend un nombre, `setStatus` une chaîne,
 * `setCategory` un identifiant ou rien. C'est reconstruit à l'envoi, et une
 * erreur là produirait un 400 incompréhensible.
 */

const CHAMPS: SearchField[] = [
  { key: 'name', label: 'Sujet', type: 'text', operators: ['contains', 'eq'] },
  {
    key: 'status',
    label: 'Statut',
    type: 'enum',
    operators: ['eq'],
    options: [
      { value: 'new', label: 'Nouveau' },
      { value: 'assigned', label: 'Attribué' },
    ],
  },
];

function ticket(id: number, nom: string) {
  return {
    id,
    name: nom,
    type: 'incident' as const,
    status: 'assigned' as const,
    urgency: 3 as const,
    impact: 3 as const,
    priority: 3 as const,
    entity: { id: 1, name: 'Racine' },
    category: null,
    dateOpened: '2026-03-01T09:00:00.000Z',
    dateDue: null,
    requesters: ['Paul Durand'],
    assignees: [],
    followupCount: 0,
    taskCount: 0,
  };
}

const RESULTATS: TicketPage = {
  items: [ticket(1, 'Panne imprimante'), ticket(2, 'Accès refusé')],
  nextCursor: null,
};

const ENREGISTREES: SavedSearch[] = [
  {
    id: 7,
    name: 'Mes incidents',
    target: 'ticket',
    isPublic: false,
    isPinned: false,
    isMine: true,
    owner: 'Alice Martin',
    criteria: {
      kind: 'group',
      link: 'and',
      children: [{ kind: 'criterion', field: 'status', operator: 'eq', value: 'new' }],
    },
  },
];

const DROITS = tousDroits(['ticket']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'searchFields').mockResolvedValue(CHAMPS);
  vi.spyOn(api, 'savedSearches').mockResolvedValue(ENREGISTREES);
});

/** Lance une recherche et attend ses résultats. */
async function chercher(utilisateur: ReturnType<typeof userEvent.setup>): Promise<void> {
  await utilisateur.click(screen.getByRole('button', { name: /Exécuter|Rechercher/i }));
  await screen.findByText('Panne imprimante');
}

describe('SearchPage', () => {
  it('propose les champs déclarés par le serveur', async () => {
    monterPage(<SearchPage />, { droits: DROITS });

    // Le catalogue vient du serveur et non d'une liste figee cote client : un
    // plugin peut declarer ses propres champs, et une liste en dur les
    // ignorerait.
    const sujet = await screen.findByRole('option', { name: 'Sujet' });

    expect(sujet).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Statut' })).toBeInTheDocument();
  });

  it('affiche les résultats en table', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'searchTickets').mockResolvedValue(RESULTATS);

    monterPage(<SearchPage />, { droits: DROITS });
    await chercher(utilisateur);

    expect(screen.getByText('Accès refusé')).toBeInTheDocument();
  });

  it('vide la sélection dès qu’une nouvelle recherche revient', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'searchTickets').mockResolvedValue(RESULTATS);

    monterPage(<SearchPage />, { droits: DROITS });
    await chercher(utilisateur);

    await utilisateur.click(screen.getByRole('checkbox', { name: /tout sélectionner/i }));

    expect(await screen.findByText(/^2 /)).toBeInTheDocument();

    // Relancer la recherche remet la selection a zero : agir sur des tickets
    // qui ne sont plus a l'ecran est le genre d'erreur qu'on ne rattrape pas.
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter|Rechercher/i }));

    await waitFor(() => {
      expect(screen.getByText(/^0 /)).toBeInTheDocument();
    });
  });

  it('reconstruit le type de la valeur selon l’action massive choisie', async () => {
    const utilisateur = userEvent.setup();
    const massive = vi
      .spyOn(api, 'bulk')
      .mockResolvedValue({ applied: 2, failures: [] });

    vi.spyOn(api, 'searchTickets').mockResolvedValue(RESULTATS);

    monterPage(<SearchPage />, { droits: DROITS });
    await chercher(utilisateur);

    await utilisateur.click(screen.getByRole('checkbox', { name: /tout sélectionner/i }));

    const actions = screen
      .getAllByRole('combobox')
      .find((liste) => within(liste).queryByRole('option', { name: /urgence/i }))!;

    await utilisateur.selectOptions(actions, 'setUrgency');
    await utilisateur.type(screen.getByPlaceholderText('1'), '5');
    await utilisateur.click(screen.getByRole('button', { name: /Appliquer/i }));

    // `setUrgency` attend un nombre : envoyer « 5 » en chaine ferait echouer la
    // validation du contrat cote serveur, avec un message sans rapport.
    await waitFor(() => {
      expect(massive).toHaveBeenCalledWith({
        ids: [1, 2],
        operation: { action: 'setUrgency', value: 5 },
      });
    });
  });

  it('n’attend aucune valeur pour une suppression massive', async () => {
    const utilisateur = userEvent.setup();
    const massive = vi.spyOn(api, 'bulk').mockResolvedValue({ applied: 2, failures: [] });

    vi.spyOn(api, 'searchTickets').mockResolvedValue(RESULTATS);

    monterPage(<SearchPage />, { droits: DROITS });
    await chercher(utilisateur);

    await utilisateur.click(screen.getByRole('checkbox', { name: /tout sélectionner/i }));

    const actions = screen
      .getAllByRole('combobox')
      .find((liste) => within(liste).queryByRole('option', { name: /urgence/i }))!;

    await utilisateur.selectOptions(actions, 'delete');

    // Le champ de valeur disparait : une suppression n'en prend pas, et le
    // laisser inviterait a saisir quelque chose que rien ne lirait.
    expect(screen.queryByPlaceholderText('1')).not.toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: /Appliquer/i }));

    await waitFor(() => {
      expect(massive).toHaveBeenCalledWith({ ids: [1, 2], operation: { action: 'delete' } });
    });
  });

  it('rend compte des échecs partiels d’une action massive', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'searchTickets').mockResolvedValue(RESULTATS);
    vi.spyOn(api, 'bulk').mockResolvedValue({
      applied: 1,
      failures: [{ id: 2, reason: 'Hors perimetre' }],
    });

    monterPage(<SearchPage />, { droits: DROITS });
    await chercher(utilisateur);

    await utilisateur.click(screen.getByRole('checkbox', { name: /tout sélectionner/i }));
    await utilisateur.click(screen.getByRole('button', { name: /Appliquer/i }));

    // « 2 tickets traites » alors qu'un seul l'a ete serait un mensonge qu'on
    // ne decouvrirait qu'en rouvrant les tickets un par un.
    expect(await screen.findByText(/1 ticket\(s\) modifié\(s\).*1 échec\(s\) : #2/)).toBeInTheDocument();
  });

  it('interdit l’action massive tant que rien n’est sélectionné', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'searchTickets').mockResolvedValue(RESULTATS);

    monterPage(<SearchPage />, { droits: DROITS });
    await chercher(utilisateur);

    expect(screen.getByRole('button', { name: /Appliquer/i })).toBeDisabled();
  });

  it('enregistre une recherche et la propose ensuite', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveSearch').mockResolvedValue(ENREGISTREES[0]!);

    monterPage(<SearchPage />, { droits: DROITS });

    expect(await screen.findByText('Mes incidents')).toBeInTheDocument();

    await utilisateur.type(screen.getByPlaceholderText(/nom/i), 'Urgents');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la recherche' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Urgents', target: 'ticket', isPublic: false }),
      );
    });
  });

  it('montre l’échec d’une recherche plutôt que de rendre une table vide', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'searchTickets').mockRejectedValue(new ApiError(400, 'Critere inconnu.'));

    monterPage(<SearchPage />, { droits: DROITS });

    await utilisateur.click(screen.getByRole('button', { name: /Exécuter|Rechercher/i }));

    // Une table vide se lit « aucun resultat » ; c'est une reponse, alors qu'il
    // s'agit d'une panne.
    expect(await screen.findByText('Critere inconnu.')).toBeInTheDocument();
  });
});
