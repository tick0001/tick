import type { Rule, RuleField, SimulationResult } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { RulesPage } from './RulesPage';

/**
 * Le moteur de règles, vu de l'écran.
 *
 * Une règle ne se lit pas seule : c'est **l'ordre** qui décide, puisque deux
 * règles touchant le même champ ne se départagent que par leur rang. L'écran
 * doit donc rendre cet ordre manipulable et le renvoyer entier au serveur —
 * c'est le comportement que ces tests tiennent, avec le simulateur, seul moyen
 * de savoir ce qu'une collection produira avant de la laisser tourner sur de
 * vrais tickets.
 */

const CHAMPS: RuleField[] = [
  {
    key: 'name',
    label: 'Titre',
    type: 'text',
    operators: ['contains', 'is'],
    actions: ['assign'],
  },
  {
    key: 'urgency',
    label: 'Urgence',
    type: 'number',
    operators: ['is'],
    actions: ['assign', 'clear'],
  },
  // Champ d'action pure : il ne doit pas apparaitre dans les criteres.
  { key: 'assignedGroupId', label: 'Groupe attribué', type: 'number', operators: [], actions: ['assign'] },
];

function regle(id: number, nom: string, rang: number, surcharge: Partial<Rule> = {}): Rule {
  return {
    id,
    collection: 'ticket.create',
    name: nom,
    description: null,
    ranking: rang,
    isActive: true,
    matchAll: true,
    stopAfter: false,
    entityId: 1,
    entityName: 'Racine',
    isRecursive: true,
    criteria: [{ field: 'name', operator: 'contains', value: 'panne' }],
    actions: [{ field: 'urgency', action: 'assign', value: '5' }],
    ...surcharge,
  };
}

const REGLES = [regle(1, 'Panne bloquante', 10), regle(2, 'Repli', 20, { isActive: false })];

const SIMULATION: SimulationResult = {
  output: { urgency: '5' },
  traces: [
    {
      ruleId: 1,
      name: 'Panne bloquante',
      matched: true,
      stopped: false,
      criteria: [
        { field: 'name', operator: 'contains', value: 'panne', actual: 'panne reseau', matched: true },
      ],
      applied: [{ field: 'urgency', value: '5' }],
    },
  ],
};

const DROITS = tousDroits(['rule']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'rules').mockResolvedValue(REGLES);
  vi.spyOn(api, 'ruleFields').mockResolvedValue(CHAMPS);
});

describe('RulesPage', () => {
  it('affiche les règles dans leur ordre, critères et actions résolus', async () => {
    monterPage(<RulesPage />, { droits: DROITS });

    expect(await screen.findByText('Panne bloquante')).toBeInTheDocument();

    // Le libelle vient du catalogue de champs, pas de la cle brute : « name »
    // ne dit rien a qui compose une regle.
    expect(screen.getAllByText(/Titre/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Urgence/).length).toBeGreaterThan(0);

    // Une regle inactive se signale : sinon on la croit en vigueur et l'on
    // cherche longtemps pourquoi elle ne s'applique pas.
    expect(screen.getByText(/\(ignorée\)/)).toBeInTheDocument();
  });

  it('refuse l’écran à qui n’a pas le droit de lire', async () => {
    vi.spyOn(api, 'rules').mockRejectedValue(new ApiError(403, 'Interdit'));

    monterPage(<RulesPage />, { droits: DROITS });

    expect(await screen.findByText(/ne permet pas/i)).toBeInTheDocument();
    expect(screen.queryByText('Panne bloquante')).not.toBeInTheDocument();
  });

  it('cache la création à qui n’a pas le droit d’écrire', async () => {
    monterPage(<RulesPage />, { droits: { 'rule:read': 'all' } });

    await screen.findByText('Panne bloquante');

    expect(screen.queryByRole('button', { name: 'Nouvelle règle' })).not.toBeInTheDocument();
  });

  it('recharge en changeant de collection', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'rules');

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    const collections = screen.getAllByRole('combobox')[0]!;

    await utilisateur.selectOptions(collections, 'ticket.update');

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith('ticket.update');
    });
  });

  it('renvoie l’ordre entier après un déplacement, et bloque les extrémités', async () => {
    const utilisateur = userEvent.setup();
    const reordonner = vi.spyOn(api, 'reorderRules').mockResolvedValue(undefined);

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    const monter = screen.getAllByRole('button', { name: 'Monter' });
    const descendre = screen.getAllByRole('button', { name: 'Descendre' });

    // La premiere ne monte pas, la derniere ne descend pas : proposer le geste
    // ferait attendre un effet qui ne viendrait jamais.
    expect(monter[0]).toBeDisabled();
    expect(descendre[1]).toBeDisabled();

    await utilisateur.click(monter[1]!);

    // L'ordre part **entier**, et non « la regle 2 passe avant la 1 » : le rang
    // se recalcule sur la liste, et un ordre partiel laisserait le serveur
    // deviner le reste.
    //
    // On lit le premier argument plutot que d'egaler l'appel : passe par
    // reference (`mutationFn: api.reorderRules`), la fonction recoit en second
    // le contexte de TanStack Query, qui ne nous regarde pas.
    await waitFor(() => {
      expect(reordonner.mock.calls[0]?.[0]).toEqual([2, 1]);
    });
  });

  it('ouvre un formulaire vide sur la collection courante', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveRule').mockResolvedValue(REGLES[0]!);

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    await utilisateur.click(screen.getByRole('button', { name: 'Nouvelle règle' }));

    const champNom = screen.getAllByRole('textbox')[0]!;

    await utilisateur.clear(champNom);
    await utilisateur.type(champNom, 'Escalade');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Escalade', collection: 'ticket.create' }),
        undefined,
      );
    });
  });

  it('reprend une règle existante et renvoie son identifiant', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveRule').mockResolvedValue(REGLES[0]!);

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Panne bloquante');

    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Panne bloquante' }),
        1,
      );
    });
  });

  it('supprime une règle', async () => {
    const utilisateur = userEvent.setup();
    const supprimer = vi.spyOn(api, 'deleteRule').mockResolvedValue(undefined);

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]!);

    await waitFor(() => {
      expect(supprimer.mock.calls[0]?.[0]).toBe(1);
    });
  });

  it('simule la collection et détaille chaque verdict', async () => {
    const utilisateur = userEvent.setup();
    const simuler = vi.spyOn(api, 'simulateRules').mockResolvedValue(SIMULATION);

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    await utilisateur.click(screen.getByRole('button', { name: 'Simuler' }));

    await waitFor(() => {
      expect(simuler).toHaveBeenCalledWith('ticket.create', {
        name: 'Incident bloquant',
        type: 'incident',
      });
    });

    // Le verdict par critere est ce qui rend la simulation utile : savoir
    // qu'une regle n'a pas pris ne dit pas laquelle de ses conditions a
    // manque.
    expect(await screen.findByText(/appliquée/)).toBeInTheDocument();
    expect(screen.getByText(/panne reseau/)).toBeInTheDocument();
  });

  it('refuse une entrée de simulation qui n’est pas du JSON', async () => {
    const utilisateur = userEvent.setup();
    const simuler = vi.spyOn(api, 'simulateRules');

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    const entree = screen.getByRole('textbox', { name: /Données/i });

    await utilisateur.clear(entree);
    await utilisateur.type(entree, 'pas du json');
    await utilisateur.click(screen.getByRole('button', { name: 'Simuler' }));

    // Le refus se voit avant l'aller-retour : envoyer au serveur une chaine
    // dont on sait deja qu'elle ne s'analyse pas ne ferait qu'attendre un 400.
    expect(await screen.findByText('JSON invalide.')).toBeInTheDocument();
    expect(simuler).not.toHaveBeenCalled();
  });

  it('affiche l’échec d’un enregistrement plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveRule').mockRejectedValue(new ApiError(409, 'Nom deja pris.'));

    monterPage(<RulesPage />, { droits: DROITS });
    await screen.findByText('Panne bloquante');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Nom deja pris.')).toBeInTheDocument();
  });
});
