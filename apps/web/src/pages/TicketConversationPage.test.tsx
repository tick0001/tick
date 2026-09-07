import type { SessionContext, TicketDetail, TimelineEntry } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { rendre } from '@/test/rendu';
import { TicketConversationPage } from './TicketConversationPage';

/**
 * Le ticket vu par celui qui l'a ouvert.
 *
 * L'écran répond à une question, et une seule : **où en est ma demande ?** Ce
 * qu'il montre doit donc se lire comme un échange, et ce qu'il tait — urgence,
 * impact, temps passé, organisation du travail — n'est pas caché par pudeur :
 * ce sont des grandeurs d'arbitrage interne, qui noieraient l'information utile
 * et laisseraient croire au demandeur qu'il a prise dessus.
 *
 * La confidentialité, elle, ne se joue pas ici : le serveur n'envoie pas les
 * suivis privés à qui n'a que la portée `own`. Un filtre d'affichage serait une
 * garantie de façade, contournable en lisant la réponse de l'API.
 */

const MOI = { id: 9, username: 'demandeur', displayName: 'Paul Durand', email: null, locale: 'fr' };

const SESSION: SessionContext = {
  user: MOI,
  entity: { id: 1, name: 'DSI', completeName: 'DSI', path: 'e1', level: 0, parentId: null },
  profile: { id: 2, name: 'Self-service', interface: 'self_service' },
  includeSubEntities: false,
  rights: { 'ticket:read': 'own' },
  available: [],
};

const TICKET: TicketDetail = {
  id: 6,
  name: 'Acces au partage comptabilite refuse',
  content: 'Message de droits insuffisants a l ouverture du dossier partage.',
  type: 'incident',
  status: 'assigned',
  urgency: 3,
  impact: 3,
  priority: 3,
  entity: { id: 1, name: 'DSI' },
  category: { id: 4, name: 'Droits' },
  requestSource: null,
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
  followupCount: 0,
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
    {
      role: 'assigned',
      actorType: 'user',
      actorId: 1,
      label: 'Alice Martin',
      alternativeEmail: null,
    },
  ],
};

const SUPPORT = { id: 1, name: 'Alice Martin' };

function reponseDuSupport(id: number, contenu: string): TimelineEntry {
  return {
    id,
    at: '2026-03-01T10:00:00.000Z',
    author: SUPPORT,
    kind: 'followup',
    content: contenu,
    isPrivate: false,
    source: 'interface',
  };
}

/**
 * La page lit son identifiant dans l'URL.
 *
 * Elle doit donc etre montee **sous une route**, et non rendue seule : sans
 * cela `useParams` ne rend rien, l'identifiant vaut `NaN`, et les appels
 * partent vers `/tickets/NaN` sans que le test s'en apercoive.
 */
function souslaRoute(session = SESSION) {
  return (
    <Routes>
      <Route path="/tickets/:id" element={<TicketConversationPage session={session} />} />
    </Routes>
  );
}

function rendrePage(entrees: TimelineEntry[], ticket: TicketDetail = TICKET) {
  vi.mocked(api.ticket).mockResolvedValue(ticket);
  vi.mocked(api.timeline).mockResolvedValue(entrees);

  return rendre(souslaRoute(), { route: '/tickets/6' });
}

describe('TicketConversationPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'ticket').mockResolvedValue(TICKET);
    vi.spyOn(api, 'timeline').mockResolvedValue([]);
    vi.spyOn(api, 'attachments').mockResolvedValue([]);
    vi.spyOn(api, 'addFollowup').mockResolvedValue(undefined);
    vi.spyOn(api, 'answerSolution').mockResolvedValue(undefined);
  });

  it('ouvre le fil avec la demande elle-même', async () => {
    rendrePage([]);

    // La demande n'est pas une « description » posée a cote du fil : c'est le
    // premier message, celui auquel tout le reste repond.
    expect(await screen.findByText(TICKET.content)).toBeInTheDocument();
  });

  it('se rabat sur le titre quand la demande n’a pas de texte', async () => {
    rendrePage([], { ...TICKET, content: '' });

    // Une bulle vide donnerait l'impression d'un message perdu. Le titre parait
    // alors deux fois : en tete, et comme premier message.
    await waitFor(() => {
      expect(screen.getAllByText(TICKET.name).length).toBe(2);
    });
  });

  it('distingue ce que j’ai écrit de ce que le support répond', async () => {
    rendrePage([
      reponseDuSupport(1, 'Nous avons ouvert les droits.'),
      {
        id: 2,
        at: '2026-03-01T11:00:00.000Z',
        author: { id: MOI.id, name: MOI.displayName },
        kind: 'followup',
        content: 'Merci, cela fonctionne.',
        isPrivate: false,
        source: 'interface',
      },
    ]);

    expect(await screen.findByText('Nous avons ouvert les droits.')).toBeInTheDocument();
    expect(screen.getByText('Alice Martin')).toBeInTheDocument();

    // Deux prises de parole de la meme personne portent le meme libelle : c'est
    // « Vous » qui rend le fil lisible, pas la couleur seule.
    expect(screen.getAllByText('Vous').length).toBeGreaterThanOrEqual(2);
  });

  it('affiche les changements d’état comme des jalons', async () => {
    rendrePage([
      {
        id: 3,
        at: '2026-03-01T10:30:00.000Z',
        author: SUPPORT,
        kind: 'log',
        field: 'status',
        oldValue: 'new',
        newValue: 'assigned',
      },
    ]);

    expect(await screen.findByText(/Statut : En cours/)).toBeInTheDocument();
  });

  it('tait les arbitrages internes', async () => {
    rendrePage([
      {
        id: 4,
        at: '2026-03-01T10:30:00.000Z',
        author: SUPPORT,
        kind: 'log',
        field: 'urgency',
        oldValue: '3',
        newValue: '5',
      },
      {
        id: 5,
        at: '2026-03-01T10:31:00.000Z',
        author: SUPPORT,
        kind: 'log',
        field: 'category',
        oldValue: null,
        newValue: 'Droits',
      },
      {
        id: 6,
        at: '2026-03-01T10:32:00.000Z',
        author: SUPPORT,
        kind: 'log',
        field: 'impact',
        oldValue: '3',
        newValue: '4',
      },
    ]);

    await screen.findByText(TICKET.content);

    // L'urgence et l'impact decident de l'ordre de traitement en interne. Les
    // afficher au demandeur donne a lire une mecanique sur laquelle il n'a pas
    // la main — et fait naitre des questions auxquelles personne ne repondra.
    expect(screen.queryByText(/urgency/)).not.toBeInTheDocument();
    expect(screen.queryByText(/impact/)).not.toBeInTheDocument();
    expect(screen.queryByText(/category/)).not.toBeInTheDocument();
  });

  it('n’expose ni urgence, ni impact, ni temps passé', async () => {
    rendrePage([]);

    await screen.findByText(TICKET.content);

    const texte = document.body.textContent ?? '';

    expect(texte).not.toContain('240');
    expect(texte).not.toMatch(/Urgence|Impact|Temps interne/);
  });

  it('rend une intervention publique sans la confondre avec un message', async () => {
    rendrePage([
      {
        id: 7,
        at: '2026-03-01T12:00:00.000Z',
        author: SUPPORT,
        kind: 'task',
        content: 'Passage sur site prevu mardi.',
        state: 'todo',
        isPrivate: false,
        actionTime: 60,
        beginAt: null,
        endAt: null,
        technician: null,
        group: null,
        category: null,
      },
    ]);

    expect(await screen.findByText('Passage sur site prevu mardi.')).toBeInTheDocument();
    expect(screen.getByText('Intervention')).toBeInTheDocument();
  });

  it('envoie un message et vide la zone de saisie', async () => {
    rendrePage([]);

    const zone = await screen.findByRole('textbox', { name: /Écrivez votre message/ });

    await userEvent.type(zone, 'Avez-vous des nouvelles ?');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => {
      expect(api.addFollowup).toHaveBeenCalledWith(6, {
        content: 'Avez-vous des nouvelles ?',
        isPrivate: false,
        source: 'interface',
      });
    });

    await waitFor(() => {
      expect(zone).toHaveValue('');
    });
  });

  it('n’envoie jamais de message privé', async () => {
    rendrePage([]);

    const zone = await screen.findByRole('textbox', { name: /Écrivez votre message/ });

    await userEvent.type(zone, 'Bonjour');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    // Un demandeur n'ecrit pas de note interne : la case n'existe pas, et le
    // drapeau part a faux sans qu'on ait a s'en souvenir.
    await waitFor(() => {
      expect(api.addFollowup).toHaveBeenCalledWith(
        6,
        expect.objectContaining({ isPrivate: false }),
      );
    });
  });

  it('refuse d’envoyer un message vide', async () => {
    rendrePage([]);

    await screen.findByText(TICKET.content);

    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
  });

  it('propose d’accepter ou de refuser une solution en attente', async () => {
    rendrePage([
      {
        id: 8,
        at: '2026-03-01T13:00:00.000Z',
        author: SUPPORT,
        kind: 'solution',
        content: 'Droits ajoutes au groupe.',
        status: 'proposed',
        solutionType: null,
        approvalComment: null,
      },
    ]);

    expect(
      await screen.findByText('Cette solution règle-t-elle votre demande ?'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cela résout ma demande' }));

    await waitFor(() => {
      expect(api.answerSolution).toHaveBeenCalledWith(6, { accepted: true });
    });
  });

  it('permet de dire que ce n’est pas résolu', async () => {
    rendrePage([
      {
        id: 9,
        at: '2026-03-01T13:00:00.000Z',
        author: SUPPORT,
        kind: 'solution',
        content: 'Droits ajoutes au groupe.',
        status: 'proposed',
        solutionType: null,
        approvalComment: null,
      },
    ]);

    await userEvent.click(await screen.findByRole('button', { name: 'Ce n’est pas résolu' }));

    // Refuser rouvre la demande cote serveur : c'est le seul geste qui evite au
    // demandeur d'avoir a rouvrir un second ticket pour le meme probleme.
    await waitFor(() => {
      expect(api.answerSolution).toHaveBeenCalledWith(6, { accepted: false });
    });
  });

  it('ne propose plus rien pour une solution déjà tranchée', async () => {
    rendrePage([
      {
        id: 10,
        at: '2026-03-01T13:00:00.000Z',
        author: SUPPORT,
        kind: 'solution',
        content: 'Droits ajoutes au groupe.',
        status: 'accepted',
        solutionType: null,
        approvalComment: null,
      },
    ]);

    expect(await screen.findByText('Droits ajoutes au groupe.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cela résout ma demande' }),
    ).not.toBeInTheDocument();
  });

  it('ferme la conversation sur une demande close', async () => {
    rendrePage([], { ...TICKET, status: 'closed' });

    expect(await screen.findByText(/Cette demande est close/)).toBeInTheDocument();

    // Ecrire sur une demande close laisserait croire qu'un message va repartir
    // vers quelqu'un, alors que plus personne ne la suit.
    expect(
      screen.queryByRole('textbox', { name: /Écrivez votre message/ }),
    ).not.toBeInTheDocument();
  });

  it('explique un refus de droit plutôt que d’afficher une panne', async () => {
    const { ApiError } = await import('@/lib/api');

    vi.mocked(api.ticket).mockRejectedValue(new ApiError(403, 'Droit manquant.'));

    rendre(souslaRoute(), { route: '/tickets/6' });

    // Un 403 dit « votre profil actif ne le permet pas », pas « une erreur est
    // survenue » : la nuance decide si l'on va voir son administrateur ou si
    // l'on rappelle plus tard.
    expect(
      await screen.findByText('Votre profil actif ne permet pas de consulter les tickets.'),
    ).toBeInTheDocument();
  });

  it('laisse déposer une pièce jointe', async () => {
    rendrePage([]);

    // Une capture d'ecran vaut souvent mieux qu'un paragraphe : la piece jointe
    // fait partie de la conversation, pas d'un ecran d'administration.
    expect(await screen.findByText(/Pièces jointes/)).toBeInTheDocument();
  });
});
