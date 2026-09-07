import type { MailCollector, MailCollectorLog } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { MailPage } from './MailPage';

/**
 * Boîtes relevées et journal de relève.
 *
 * « Pourquoi ce courriel n'a-t-il pas créé de ticket » est la seule question
 * qu'on pose vraiment à cet écran, et elle ne se répond que par le journal :
 * un message peut avoir été ignoré, refusé, rattaché en suivi à un ticket
 * existant, ou avoir échoué. Sans ce détail, la boîte a juste l'air muette.
 *
 * Le mot de passe suit la règle des annuaires : jamais renvoyé, et un
 * enregistrement qui n'y touche pas ne doit pas l'effacer.
 */

const COLLECTEUR: MailCollector = {
  id: 1,
  name: 'Support',
  host: 'imap.exemple.fr',
  port: 993,
  useTls: true,
  login: 'support',
  folder: 'INBOX',
  afterRead: 'flag',
  targetFolder: null,
  isActive: true,
  entityId: 1,
  entityName: 'Racine',
  profileId: 2,
  requestSourceId: null,
  createUnknownRequester: false,
  maxPerRun: 50,
  lastRunAt: '2026-03-02T08:00:00.000Z',
  lastError: null,
  hasPassword: true,
};

const JOURNAL: MailCollectorLog[] = [
  {
    id: 1,
    collectorId: 1,
    messageId: '<a@exemple.fr>',
    sender: 'paul@exemple.fr',
    subject: 'Mon écran ne s’allume plus',
    action: 'ticket',
    ticketId: 12,
    detail: null,
    createdAt: '2026-03-02T08:00:00.000Z',
  },
  {
    id: 2,
    collectorId: 1,
    messageId: '<b@exemple.fr>',
    sender: 'inconnu@ailleurs.fr',
    subject: 'Publicité',
    action: 'refused',
    ticketId: null,
    detail: 'Expediteur inconnu',
    createdAt: '2026-03-02T08:01:00.000Z',
  },
];

const DROITS = tousDroits(['mailcollector']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'mailCollectors').mockResolvedValue([COLLECTEUR]);
  vi.spyOn(api, 'mailCollectorLogs').mockResolvedValue(JOURNAL);
});

describe('MailPage', () => {
  it('affiche la boîte et sa dernière relève', async () => {
    monterPage(<MailPage />, { droits: DROITS });

    expect(await screen.findByText('Support')).toBeInTheDocument();
    expect(screen.getByText(/imap\.exemple\.fr/)).toBeInTheDocument();
    expect(screen.getByText(/Dernière relève/)).toBeInTheDocument();
  });

  it('signale la dernière erreur de relève', async () => {
    vi.spyOn(api, 'mailCollectors').mockResolvedValue([
      { ...COLLECTEUR, lastError: 'Connexion refusee' },
    ]);

    monterPage(<MailPage />, { droits: DROITS });

    // Sans ce signal, une boite qui ne releve plus a l'air de fonctionner : la
    // configuration est bonne, seule la connexion echoue.
    expect(await screen.findByText(/Connexion refusee/)).toBeInTheDocument();
  });

  it('ouvre le journal et dit ce que chaque message est devenu', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<MailPage />, { droits: DROITS });
    await screen.findByText('Support');

    await utilisateur.click(screen.getByRole('button', { name: 'Journal' }));

    expect(await screen.findByText('Mon écran ne s’allume plus')).toBeInTheDocument();

    // Le motif du refus est la vraie reponse : « refuse » seul renvoie a la
    // meme question.
    expect(screen.getByText(/Expediteur inconnu/)).toBeInTheDocument();
  });

  it('déclenche une relève à la demande', async () => {
    const utilisateur = userEvent.setup();
    const relever = vi.spyOn(api, 'collectMail').mockResolvedValue({ processed: 3 });

    monterPage(<MailPage />, { droits: DROITS });
    await screen.findByText('Support');

    await utilisateur.click(screen.getByRole('button', { name: 'Relever' }));

    // Attendre la prochaine relève programmée pour vérifier une configuration
    // rendrait chaque essai long d'un quart d'heure.
    await waitFor(() => {
      expect(relever.mock.calls[0]?.[0]).toBe(1);
    });
  });

  it('n’envoie pas de mot de passe quand on n’y touche pas', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveMailCollector').mockResolvedValue(COLLECTEUR);

    monterPage(<MailPage />, { droits: DROITS });
    await screen.findByText('Support');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    const nom = await screen.findByDisplayValue('Support');

    await utilisateur.clear(nom);
    await utilisateur.type(nom, 'Support N1');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalled();
    });

    // Une chaine vide effacerait le mot de passe enregistre, et la boite
    // cesserait de se relever sans que rien ne l'annonce avant la prochaine
    // echeance.
    const [corps] = enregistrer.mock.calls[0]!;

    expect(corps.name).toBe('Support N1');
    expect(corps.password).toBeUndefined();
  });

  it('supprime une boîte', async () => {
    const utilisateur = userEvent.setup();
    const supprimer = vi.spyOn(api, 'deleteMailCollector').mockResolvedValue(undefined);

    monterPage(<MailPage />, { droits: DROITS });
    await screen.findByText('Support');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]!);

    await waitFor(() => {
      expect(supprimer.mock.calls[0]?.[0]).toBe(1);
    });
  });

  it('cache la création à qui n’a pas le droit d’écrire', async () => {
    monterPage(<MailPage />, { droits: { 'mailcollector:read': 'all' } });

    await screen.findByText('Support');

    expect(screen.queryByRole('button', { name: /Nouvelle boîte/ })).not.toBeInTheDocument();
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveMailCollector').mockRejectedValue(new ApiError(400, 'Hote injoignable.'));

    monterPage(<MailPage />, { droits: DROITS });
    await screen.findByText('Support');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Hote injoignable.')).toBeInTheDocument();
  });

  it('annonce l’absence de boîte', async () => {
    vi.spyOn(api, 'mailCollectors').mockResolvedValue([]);

    monterPage(<MailPage />, { droits: DROITS });

    expect(await screen.findByText('Aucune boîte relevée.')).toBeInTheDocument();
  });
});
