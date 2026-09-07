import type { ItilLink, TicketDetail, TimelineEntry } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { TicketPage } from './TicketPage';

/**
 * Le ticket vu par celui qui le traite.
 *
 * C'est l'écran opposé à la conversation du demandeur : il montre tout — les
 * grandeurs d'arbitrage, le temps passé, les liens vers d'autres objets — et
 * il permet d'agir.
 *
 * Le point le plus délicat est le **suivi privé**, une note interne que le
 * demandeur ne doit jamais lire. Le drapeau part avec le message, et une case
 * qui ne serait pas transmise publierait au demandeur ce qu'on croyait garder
 * pour l'équipe. C'est irrattrapable : le courriel est déjà parti.
 */

const TICKET: TicketDetail = {
  id: 6,
  name: 'Accès au partage refusé',
  content: 'Message de droits insuffisants.',
  type: 'incident',
  status: 'assigned',
  urgency: 4,
  impact: 2,
  priority: 3,
  entity: { id: 1, name: 'DSI' },
  category: { id: 4, name: 'Droits' },
  requestSource: { id: 1, name: 'Interface' },
  location: null,
  dateOpened: '2026-03-01T09:00:00.000Z',
  dateDue: null,
  dateTakenIntoAccount: null,
  dateSolved: null,
  dateClosed: null,
  internalTime: 240,
  createdBy: { id: 9, name: 'Paul Durand' },
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
  requesters: ['Paul Durand'],
  assignees: ['Alice Martin'],
  followupCount: 1,
  taskCount: 0,
  waitingDuration: 0,
  validationStatus: null,
  actors: [
    {
      role: 'requester',
      actorType: 'user',
      actorId: 9,
      label: 'Paul Durand',
      alternativeEmail: null,
    },
  ],
};

const CHRONOLOGIE: TimelineEntry[] = [
  {
    id: 1,
    at: '2026-03-01T10:00:00.000Z',
    author: { id: 1, name: 'Alice Martin' },
    kind: 'followup',
    content: 'Je regarde vos droits.',
    isPrivate: false,
    source: 'interface',
  },
];

const LIENS: ItilLink[] = [];
const DROITS = tousDroits(['ticket']);

/**
 * La page lit son identifiant dans l'URL.
 *
 * Sans route, `useParams` ne rend rien, l'identifiant vaut `NaN`, et les
 * appels partent vers `/tickets/NaN` sans que le test s'en aperçoive.
 */
function rendre(droits = DROITS) {
  return monterPage(
    <Routes>
      <Route path="/tickets/:id" element={<TicketPage />} />
    </Routes>,
    { droits, route: '/tickets/6' },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'ticket').mockResolvedValue(TICKET);
  vi.spyOn(api, 'timeline').mockResolvedValue(CHRONOLOGIE);
  vi.spyOn(api, 'links').mockResolvedValue(LIENS);
  vi.spyOn(api, 'ticketAgreements').mockResolvedValue([]);
  vi.spyOn(api, 'attachments').mockResolvedValue([]);
});

describe('TicketPage', () => {
  it('montre les grandeurs d’arbitrage, que la conversation tait', async () => {
    rendre();

    expect(await screen.findByText('Accès au partage refusé')).toBeInTheDocument();

    // Urgence, impact et temps passe sont des grandeurs internes : elles n'ont
    // pas leur place chez le demandeur, elles ont toute leur place ici.
    expect(screen.getByText('4 / 5')).toBeInTheDocument();
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByText(/240/)).toBeInTheDocument();
  });

  it('affiche la chronologie', async () => {
    rendre();

    expect(await screen.findByText('Je regarde vos droits.')).toBeInTheDocument();
  });

  it('transmet le drapeau privé avec le suivi', async () => {
    const utilisateur = userEvent.setup();
    const publier = vi.spyOn(api, 'addFollowup').mockResolvedValue(undefined);

    rendre();
    await screen.findByText('Accès au partage refusé');

    await utilisateur.type(
      screen.getByPlaceholderText(/Décrire ce qui a été fait/),
      'Le groupe AD manquait.',
    );
    await utilisateur.click(screen.getByRole('checkbox', { name: /privé/i }));
    await utilisateur.click(screen.getByRole('button', { name: /Envoyer|Publier/i }));

    // Une case non transmise publierait au demandeur ce qu'on croyait garder
    // pour l'equipe -- et le courriel serait deja parti.
    await waitFor(() => {
      expect(publier).toHaveBeenCalledWith(6, {
        content: 'Le groupe AD manquait.',
        isPrivate: true,
        source: 'interface',
      });
    });
  });

  it('refuse de publier un suivi vide', async () => {
    const utilisateur = userEvent.setup();
    const publier = vi.spyOn(api, 'addFollowup');

    rendre();
    await screen.findByText('Accès au partage refusé');

    await utilisateur.click(screen.getByRole('button', { name: /Envoyer|Publier/i }));

    // Un suivi vide n'apporte rien et remonte le ticket dans les listes comme
    // s'il avait avance.
    expect(publier).not.toHaveBeenCalled();
  });

  it('change le statut', async () => {
    const utilisateur = userEvent.setup();
    const changer = vi.spyOn(api, 'setStatus').mockResolvedValue(TICKET);

    rendre();
    await screen.findByText('Accès au partage refusé');

    const statuts = await screen.findByLabelText(/Changer le statut|Statut/i);

    await utilisateur.selectOptions(statuts, 'solved');

    await waitFor(() => {
      expect(changer).toHaveBeenCalledWith(6, 'solved');
    });
  });

  it('cache les actions à qui n’a que la lecture', async () => {
    rendre({ 'ticket:read': 'all' });

    await screen.findByText('Accès au partage refusé');

    expect(screen.queryByRole('button', { name: /Envoyer|Publier/i })).not.toBeInTheDocument();
  });

  it('distingue un refus de droit d’une panne', async () => {
    vi.spyOn(api, 'ticket').mockRejectedValue(new ApiError(403, 'Interdit'));

    rendre();

    // Un 403 est une reponse, pas une panne : le presenter comme une erreur
    // ferait chercher du cote du serveur.
    expect(await screen.findByText(/ne permet pas/i)).toBeInTheDocument();
  });

  it('remonte le message du serveur pour les autres erreurs', async () => {
    vi.spyOn(api, 'ticket').mockRejectedValue(new ApiError(404, 'Ticket introuvable.'));

    rendre();

    expect(await screen.findByText('Ticket introuvable.')).toBeInTheDocument();
  });
});
