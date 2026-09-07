import type { PlanningEntry, RecurringTicket, TicketTemplate } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { PlanningPage } from './PlanningPage';

/**
 * Planning et tickets récurrents.
 *
 * L'écran existe pour une chose : voir les **chevauchements**. Une tâche
 * planifiée sur un technicien déjà occupé ou absent est un engagement qui ne
 * sera pas tenu, et c'est invisible tant que quelqu'un ne rapproche pas les
 * deux calendriers. Le serveur calcule les conflits, l'écran doit les compter
 * et les signaler ligne à ligne.
 *
 * La fenêtre interrogée dépend de la vue — jour, semaine, mois — et c'est elle
 * qui part au serveur : charger tout puis filtrer ici ramènerait un an de
 * planning pour en afficher une journée.
 */

function entree(
  id: number,
  titre: string,
  surcharge: Partial<PlanningEntry> = {},
): PlanningEntry {
  return {
    kind: 'task',
    id,
    beginAt: '2026-03-02T09:00:00.000Z',
    endAt: '2026-03-02T11:00:00.000Z',
    title: titre,
    userId: 10,
    userName: 'Léa Moreau',
    groupId: null,
    groupName: null,
    itilType: 'ticket',
    itilId: 5,
    state: 'todo',
    conflicts: [],
    ...surcharge,
  };
}

const PLANNING: PlanningEntry[] = [
  entree(1, 'Remplacer l’écran', { conflicts: [2] }),
  entree(2, 'Congés', {
    kind: 'unavailability',
    itilType: null,
    itilId: null,
    state: null,
    conflicts: [1],
  }),
  entree(3, 'Migration serveur', { userId: 11, userName: 'Thomas Petit' }),
];

const GABARITS: TicketTemplate[] = [
  {
    id: 1,
    name: 'Incident standard',
    comment: null,
    entity: { id: 1, name: 'Racine' },
    isRecursive: true,
    predefined: {},
    mandatory: [],
    hidden: [],
  },
];

const RECURRENTS: RecurringTicket[] = [
  {
    id: 1,
    name: 'Sauvegarde hebdomadaire',
    content: 'Vérifier les journaux',
    isActive: true,
    templateId: 1,
    templateName: 'Incident standard',
    entityId: 1,
    entityName: 'Racine',
    step: 'weekly',
    interval: 1,
    beginAt: '2026-01-01T08:00:00.000Z',
    endAt: null,
    createAheadMinutes: 60,
    nextOccurrenceAt: '2026-03-09T08:00:00.000Z',
    lastRunAt: '2026-03-02T08:00:00.000Z',
    runCount: 9,
  },
];

const DROITS = tousDroits(['planning', 'recurrence']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'planning').mockResolvedValue(PLANNING);
  vi.spyOn(api, 'recurring').mockResolvedValue(RECURRENTS);
  vi.spyOn(api, 'templates').mockResolvedValue(GABARITS);
});

describe('PlanningPage', () => {
  it('compte les chevauchements et les signale ligne à ligne', async () => {
    monterPage(<PlanningPage />, { droits: DROITS });

    expect(await screen.findByText('Remplacer l’écran')).toBeInTheDocument();

    // Deux entrees en conflit, donc deux lignes marquees : une tache posee sur
    // un technicien absent est un engagement qui ne sera pas tenu.
    expect(screen.getAllByText('Conflit')).toHaveLength(2);
    expect(screen.getByText(/2 chevauchements détectés/)).toBeInTheDocument();
  });

  it('distingue une indisponibilité d’une tâche', async () => {
    monterPage(<PlanningPage />, { droits: DROITS });

    await screen.findByText('Congés');

    // Une absence n'est pas du travail : la rendre comme une tache ferait
    // croire a une charge la ou il n'y a personne.
    expect(screen.getByText('Indisponibilité')).toBeInTheDocument();
  });

  it('demande au serveur la fenêtre de la vue choisie', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'planning');

    monterPage(<PlanningPage />, { droits: DROITS });
    await screen.findByText('Remplacer l’écran');

    const avant = lire.mock.calls.length;

    await utilisateur.click(screen.getByRole('tab', { name: 'Jour' }));

    // Charger tout puis filtrer ici ramenerait une annee de planning pour en
    // afficher une journee.
    await waitFor(() => {
      expect(lire.mock.calls.length).toBeGreaterThan(avant);
    });

    const dernier = lire.mock.calls.at(-1)![0];
    const duree = new Date(dernier.to).getTime() - new Date(dernier.from).getTime();

    expect(duree).toBe(24 * 3600 * 1000);
  });

  it('filtre sur un technicien', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'planning');

    monterPage(<PlanningPage />, { droits: DROITS });
    await screen.findByText('Remplacer l’écran');

    await utilisateur.selectOptions(screen.getByDisplayValue('Tous'), '11');

    await waitFor(() => {
      expect(lire.mock.calls.at(-1)![0].technicianId).toBe(11);
    });
  });

  it('n’ouvre la déclaration d’absence qu’une fois un technicien choisi', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<PlanningPage />, { droits: DROITS });
    await screen.findByText('Remplacer l’écran');

    // Une indisponibilite appartient a quelqu'un : la declarer « pour tous »
    // n'a pas de sens, le bouton reste donc ferme.
    expect(screen.getByRole('button', { name: /Déclarer une indisponibilité/ })).toBeDisabled();

    await utilisateur.selectOptions(screen.getByDisplayValue('Tous'), '10');

    expect(
      screen.getByRole('button', { name: /Déclarer une indisponibilité/ }),
    ).not.toBeDisabled();
  });

  it('déclare une indisponibilité pour le technicien filtré', async () => {
    const utilisateur = userEvent.setup();
    const declarer = vi.spyOn(api, 'createUnavailability').mockResolvedValue(undefined);

    monterPage(<PlanningPage />, { droits: DROITS });
    await screen.findByText('Remplacer l’écran');

    await utilisateur.selectOptions(screen.getByDisplayValue('Tous'), '10');
    await utilisateur.click(screen.getByRole('button', { name: /Déclarer une indisponibilité/ }));

    await utilisateur.type(await screen.findByLabelText('Début'), '2026-03-10T09:00');
    await utilisateur.type(screen.getByLabelText('Fin'), '2026-03-10T17:00');
    await utilisateur.type(screen.getByLabelText('Motif'), 'Formation');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(declarer).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 10, reason: 'Formation' }),
      );
    });
  });

  it('retire une indisponibilité', async () => {
    const utilisateur = userEvent.setup();
    const retirer = vi.spyOn(api, 'deleteUnavailability').mockResolvedValue(undefined);

    monterPage(<PlanningPage />, { droits: DROITS });
    await screen.findByText('Congés');

    await utilisateur.click(screen.getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => {
      expect(retirer).toHaveBeenCalledWith(2);
    });
  });

  it('bascule sur les tickets récurrents', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<PlanningPage />, { droits: DROITS });
    await screen.findByText('Remplacer l’écran');

    await utilisateur.click(screen.getByRole('tab', { name: /Récurrence|Tickets récurrents/i }));

    expect(await screen.findByText('Sauvegarde hebdomadaire')).toBeInTheDocument();

    // Le gabarit porte le type, la categorie et les acteurs : la recurrence
    // n'ajoute que le titre, la description et le calendrier.
    expect(screen.getByText(/Incident standard/)).toBeInTheDocument();
  });

  it('annonce une période vide plutôt que de laisser un calendrier muet', async () => {
    vi.spyOn(api, 'planning').mockResolvedValue([]);

    monterPage(<PlanningPage />, { droits: DROITS });

    expect(await screen.findByText(/Rien de planifié/)).toBeInTheDocument();
  });

  it('cache la déclaration d’absence à qui n’a pas le droit', async () => {
    monterPage(<PlanningPage />, { droits: { 'planning:read': 'all' } });

    await screen.findByText('Remplacer l’écran');

    expect(
      screen.queryByRole('button', { name: /Déclarer une indisponibilité/ }),
    ).not.toBeInTheDocument();
  });
});
