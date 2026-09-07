import type {
  Dashboard,
  StatsReport,
  StatsTrendPoint,
  WidgetCatalogEntry,
} from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { StatsPage } from './StatsPage';

/**
 * Indicateurs et tableaux de bord.
 *
 * Ce que l'écran doit surtout savoir faire, c'est **ne pas mentir quand il n'y
 * a rien à dire** : une moyenne de résolution nulle et une moyenne inconnue
 * sont deux choses différentes, et afficher « 0 » pour la seconde ferait
 * conclure à une résolution instantanée. Le contrat le dit en `null`, l'écran
 * doit le rendre visible.
 *
 * Le reste tient à la fenêtre d'observation et à la dimension d'analyse, qui
 * partent au serveur : agréger ici obligerait à transporter tous les tickets.
 */

const RAPPORT: StatsReport = {
  dimension: 'status',
  summary: {
    opened: 120,
    solved: 100,
    closed: 95,
    pending: 20,
    averageTakeIntoAccount: 1800,
    // Inconnue : aucun ticket n'a atteint la resolution sur la periode.
    averageSolve: null,
    slaCompliance: 0.92,
    satisfaction: 4.2,
    satisfactionCount: 33,
  },
  buckets: [
    { key: 'new', label: 'Nouveau', opened: 40, solved: 0, closed: 0, averageSolve: null },
    { key: 'solved', label: 'Résolu', opened: 80, solved: 100, closed: 95, averageSolve: 7200 },
  ],
};

const TENDANCE: StatsTrendPoint[] = [
  { day: '2026-03-01', opened: 5, closed: 3 },
  { day: '2026-03-02', opened: 8, closed: 6 },
];

const CATALOGUE: WidgetCatalogEntry[] = [
  { kind: 'ticket-count', label: 'Nombre de tickets', description: 'Le compte du périmètre' },
];

const TABLEAUX: Dashboard[] = [
  {
    id: 1,
    name: 'Pilotage hebdomadaire',
    isPublic: true,
    isRecursive: false,
    isMine: true,
    entityId: 1,
    entityName: 'Racine',
    owner: 'Alice Martin',
    widgets: [
      { id: 1, kind: 'ticket-count', title: 'Ouverts', position: 0, width: 4, config: {} },
    ],
  },
];

const DROITS = tousDroits(['stat', 'dashboard']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'stats').mockResolvedValue(RAPPORT);
  vi.spyOn(api, 'statsTrend').mockResolvedValue(TENDANCE);
  vi.spyOn(api, 'dashboards').mockResolvedValue(TABLEAUX);
  vi.spyOn(api, 'widgetCatalog').mockResolvedValue(CATALOGUE);
});

describe('StatsPage', () => {
  it('affiche les indicateurs du périmètre', async () => {
    monterPage(<StatsPage />, { droits: DROITS });

    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('distingue une moyenne inconnue d’une moyenne nulle', async () => {
    monterPage(<StatsPage />, { droits: DROITS });

    await screen.findByText('120');

    // `averageSolve` vaut `null` : aucun ticket n'a atteint la resolution.
    // Afficher « 0 » ferait conclure a une resolution instantanee.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('détaille la répartition par la dimension choisie', async () => {
    monterPage(<StatsPage />, { droits: DROITS });

    expect(await screen.findByText('Nouveau')).toBeInTheDocument();
    expect(screen.getByText('Résolu')).toBeInTheDocument();
  });

  it('envoie la dimension et la fenêtre au serveur', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'stats');

    monterPage(<StatsPage />, { droits: DROITS });
    await screen.findByText('Nouveau');

    const dimensions = screen
      .getAllByRole('combobox')
      .find((liste) => liste.querySelector('option[value="category"]'))!;

    await utilisateur.selectOptions(dimensions, 'category');

    // Agreger ici obligerait a transporter tous les tickets pour n'en garder
    // qu'un compte par categorie.
    await waitFor(() => {
      expect(lire.mock.calls.at(-1)![0].dimension).toBe('category');
    });
  });

  it('bascule sur les tableaux de bord', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<StatsPage />, { droits: DROITS });
    await screen.findByText('Nouveau');

    await utilisateur.click(screen.getByRole('tab', { name: /Tableaux/i }));

    expect(await screen.findByText('Pilotage hebdomadaire')).toBeInTheDocument();

    // Public ou personnel : un tableau partage se modifie sous les yeux des
    // autres, et c'est ce qu'il faut savoir avant d'y toucher.
    expect(screen.getByText(/Public|Partagé/i)).toBeInTheDocument();
  });

  it('crée un tableau de bord', async () => {
    const utilisateur = userEvent.setup();
    const creer = vi.spyOn(api, 'saveDashboard').mockResolvedValue(TABLEAUX[0]!);

    monterPage(<StatsPage />, { droits: DROITS });
    await screen.findByText('Nouveau');

    await utilisateur.click(screen.getByRole('tab', { name: /Tableaux/i }));
    await utilisateur.type(await screen.findByLabelText(/Nom/), 'Suivi mensuel');
    await utilisateur.click(screen.getByRole('button', { name: /Nouveau tableau/i }));

    await waitFor(() => {
      expect(creer).toHaveBeenCalledWith(expect.objectContaining({ name: 'Suivi mensuel' }));
    });
  });

  it('supprime un tableau de bord', async () => {
    const utilisateur = userEvent.setup();
    const supprimer = vi.spyOn(api, 'deleteDashboard').mockResolvedValue(undefined);

    monterPage(<StatsPage />, { droits: DROITS });
    await screen.findByText('Nouveau');

    await utilisateur.click(screen.getByRole('tab', { name: /Tableaux/i }));
    await utilisateur.click(await screen.findByRole('button', { name: 'Supprimer' }));

    await waitFor(() => {
      expect(supprimer).toHaveBeenCalledWith(1);
    });
  });
});
