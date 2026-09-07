import type {
  NotificationEvent,
  NotificationPreference,
  NotificationQueueEntry,
  NotificationTemplate,
} from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { NotificationsPage } from './NotificationsPage';

/**
 * Modèles de notification, file d'envoi et préférences.
 *
 * L'écran sert **deux publics sur la même page**, et c'est ce qui s'y vérifie :
 * chacun règle ce qu'il veut recevoir, tandis que les modèles et la file
 * n'apparaissent qu'à qui administre. La bascule ne tient pas au droit déclaré
 * mais au refus du serveur — un 403 sur les modèles suffit à replier la partie
 * d'administration, ce qui évite de raisonner deux fois sur la même règle.
 */

const EVENEMENTS: NotificationEvent[] = [
  { name: 'ticket.created', label: 'Ticket ouvert' },
  { name: 'ticket.solved', label: 'Ticket résolu' },
];

const PREFERENCES: NotificationPreference[] = [
  { event: 'ticket.created', label: 'Ticket ouvert', enabled: true },
  { event: 'ticket.solved', label: 'Ticket résolu', enabled: false },
];

const MODELES: NotificationTemplate[] = [
  {
    id: 3,
    event: 'ticket.created',
    name: 'Accusé de réception',
    isActive: true,
    entityId: 1,
    entityName: 'Racine',
    isRecursive: true,
    targets: [{ target: 'requester', address: null }],
    translations: [{ locale: 'fr', subject: 'Votre demande', bodyText: 'Bonjour', bodyHtml: null }],
  },
  {
    id: 4,
    event: 'ticket.solved',
    name: 'Clôture',
    isActive: false,
    entityId: 1,
    entityName: 'Racine',
    isRecursive: false,
    targets: [{ target: 'fixed', address: 'supervision@exemple.fr' }],
    translations: [{ locale: 'fr', subject: 'Résolu', bodyText: 'Fin', bodyHtml: null }],
  },
];

const FILE: NotificationQueueEntry[] = [
  {
    id: 100,
    event: 'ticket.created',
    itemType: 'ticket',
    itemId: 1,
    recipientEmail: 'paul@exemple.fr',
    subject: 'Votre demande',
    state: 'failed',
    attempts: 3,
    lastError: 'Serveur injoignable',
    createdAt: '2026-03-01T09:00:00.000Z',
    sentAt: null,
  },
  {
    id: 101,
    event: 'ticket.solved',
    itemType: 'ticket',
    itemId: 1,
    recipientEmail: 'lea@exemple.fr',
    subject: 'Résolu',
    state: 'sent',
    attempts: 1,
    lastError: null,
    createdAt: '2026-03-02T09:00:00.000Z',
    sentAt: '2026-03-02T09:01:00.000Z',
  },
];

const DROITS = tousDroits(['notification']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'notificationEvents').mockResolvedValue(EVENEMENTS);
  vi.spyOn(api, 'notificationVariables').mockResolvedValue(['{{ticket.name}}']);
  vi.spyOn(api, 'notificationTemplates').mockResolvedValue(MODELES);
  vi.spyOn(api, 'notificationQueue').mockResolvedValue(FILE);
  vi.spyOn(api, 'notificationPreferences').mockResolvedValue(PREFERENCES);
});

describe('NotificationsPage', () => {
  it('résout le nom technique de l’événement en libellé', async () => {
    monterPage(<NotificationsPage />, { droits: DROITS });

    expect(await screen.findByText('Accusé de réception')).toBeInTheDocument();

    // « ticket.created » est un identifiant de code : l'afficher tel quel
    // demanderait au lecteur de connaitre la nomenclature interne.
    expect(screen.getByText(/Ticket ouvert · Racine/)).toBeInTheDocument();
  });

  it('signale un modèle inactif et détaille ses destinataires', async () => {
    monterPage(<NotificationsPage />, { droits: DROITS });

    await screen.findByText('Clôture');

    // Un modele inactif se croit en service tant que rien ne le dit, et l'on
    // cherche pourquoi le message ne part pas.
    expect(screen.getByText(/\(annulé\)|\(Annulé\)/i)).toBeInTheDocument();

    // Le destinataire fixe s'affiche par son adresse, les roles par leur nom :
    // « fixe » seul ne dirait pas a qui l'on ecrit.
    expect(screen.getByText('supervision@exemple.fr')).toBeInTheDocument();
  });

  it('replie l’administration quand le serveur refuse les modèles', async () => {
    vi.spyOn(api, 'notificationTemplates').mockRejectedValue(new ApiError(403, 'Interdit'));

    monterPage(<NotificationsPage />, { droits: {} });

    // Les preferences restent : chacun regle ce qu'il recoit, meme sans droit
    // d'administration.
    expect(await screen.findByText('Ticket résolu')).toBeInTheDocument();
    expect(screen.queryByText('File d’envoi')).not.toBeInTheDocument();
    expect(screen.queryByText('Accusé de réception')).not.toBeInTheDocument();
  });

  it('bascule une préférence sans toucher aux autres', async () => {
    const utilisateur = userEvent.setup();
    const basculer = vi.spyOn(api, 'setNotificationPreference').mockResolvedValue(undefined);

    monterPage(<NotificationsPage />, { droits: DROITS });

    const resolu = await screen.findByRole('checkbox', { name: 'Ticket résolu' });

    expect(resolu).not.toBeChecked();

    await utilisateur.click(resolu);

    await waitFor(() => {
      expect(basculer).toHaveBeenCalledWith('ticket.solved', true);
    });
  });

  it('n’offre de rejouer que ce qui n’est pas parti', async () => {
    const utilisateur = userEvent.setup();
    const rejouer = vi.spyOn(api, 'replayNotification').mockResolvedValue(undefined);

    monterPage(<NotificationsPage />, { droits: DROITS });

    await screen.findByText('paul@exemple.fr');

    // La cause de l'echec accompagne la ligne : « echec » seul obligerait a
    // aller lire les journaux du serveur.
    expect(screen.getByText('Serveur injoignable')).toBeInTheDocument();

    // Deux messages, un seul bouton : rejouer un envoi reussi le dupliquerait.
    const boutons = screen.getAllByRole('button', { name: 'Rejouer' });

    expect(boutons).toHaveLength(1);

    await utilisateur.click(boutons[0]!);

    await waitFor(() => {
      expect(rejouer.mock.calls[0]?.[0]).toBe(100);
    });
  });

  it('filtre la file par état', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'notificationQueue');

    monterPage(<NotificationsPage />, { droits: DROITS });
    await screen.findByText('paul@exemple.fr');

    await utilisateur.selectOptions(screen.getByDisplayValue('Tous les états'), 'failed');

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith('failed');
    });
  });

  it('purge la file', async () => {
    const utilisateur = userEvent.setup();
    const purger = vi.spyOn(api, 'purgeNotifications').mockResolvedValue({ removed: 12 });

    monterPage(<NotificationsPage />, { droits: DROITS });
    await screen.findByText('paul@exemple.fr');

    await utilisateur.click(screen.getByRole('button', { name: /Purger/ }));

    await waitFor(() => {
      expect(purger).toHaveBeenCalled();
    });
  });

  it('cache la création à qui n’a pas le droit d’écrire', async () => {
    monterPage(<NotificationsPage />, { droits: { 'notification:read': 'all' } });

    await screen.findByText('Accusé de réception');

    expect(screen.queryByRole('button', { name: 'Nouveau modèle' })).not.toBeInTheDocument();
  });

  it('reprend un modèle existant et renvoie son identifiant', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveNotificationTemplate').mockResolvedValue(MODELES[0]!);

    monterPage(<NotificationsPage />, { droits: DROITS });
    await screen.findByText('Accusé de réception');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    expect(await screen.findByDisplayValue('Accusé de réception')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Votre demande')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Accusé de réception', event: 'ticket.created' }),
        3,
      );
    });
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveNotificationTemplate').mockRejectedValue(
      new ApiError(400, 'Modele sans traduction.'),
    );

    monterPage(<NotificationsPage />, { droits: DROITS });
    await screen.findByText('Accusé de réception');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Modele sans traduction.')).toBeInTheDocument();
  });
});
