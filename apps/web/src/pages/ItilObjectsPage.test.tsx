import type { ItilObjectSummary } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { ItilObjectsPage } from './ItilObjectsPage';

/**
 * Problèmes et changements, sur un seul écran.
 *
 * Les deux partagent la colonne à la ligne près, et seuls le titre et le
 * formulaire de création diffèrent. Deux pages presque identiques auraient
 * divergé dès la première correction — ce que ces tests vérifient en montant
 * la même page sous ses deux natures.
 *
 * La recherche part au serveur, comme partout ailleurs : filtrer la page ne
 * trouverait jamais au-delà de ce qui est déjà chargé.
 */

function objet(
  id: number,
  nom: string,
  surcharge: Partial<ItilObjectSummary> = {},
): ItilObjectSummary {
  return {
    id,
    kind: 'problem',
    name: nom,
    status: 'assigned',
    urgency: 3,
    impact: 3,
    priority: 3,
    entityId: 1,
    entityName: 'Racine',
    categoryId: null,
    categoryName: null,
    dateOpened: '2026-03-01T09:00:00.000Z',
    requesters: ['Alice Martin'],
    assignees: [],
    followupCount: 0,
    taskCount: 0,
    ...surcharge,
  };
}

const PROBLEMES = [objet(1, 'Lenteurs récurrentes'), objet(2, 'Coupures réseau')];
const CHANGEMENTS = [objet(9, 'Migration du serveur', { kind: 'change' })];

const DROITS = tousDroits(['problem', 'change']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'itilObjects').mockResolvedValue(PROBLEMES);
});

describe('ItilObjectsPage', () => {
  it('liste les problèmes du périmètre', async () => {
    monterPage(<ItilObjectsPage kind="problem" />, { droits: DROITS });

    expect(await screen.findByText('Lenteurs récurrentes')).toBeInTheDocument();
    expect(screen.getByText('Coupures réseau')).toBeInTheDocument();
  });

  it('sert les changements avec le même écran', async () => {
    vi.spyOn(api, 'itilObjects').mockResolvedValue(CHANGEMENTS);

    monterPage(<ItilObjectsPage kind="change" />, { droits: DROITS });

    expect(await screen.findByText('Migration du serveur')).toBeInTheDocument();

    // Le titre suit la nature : c'est la seule chose qui change d'un objet a
    // l'autre, avec le formulaire de creation.
    expect(screen.getByRole('heading', { name: /Changements/ })).toBeInTheDocument();
  });

  it('demande la liste au serveur pour la nature affichée', async () => {
    const lire = vi.spyOn(api, 'itilObjects');

    monterPage(<ItilObjectsPage kind="change" />, { droits: DROITS });

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith('change', {});
    });
  });

  it('cherche côté serveur plutôt que dans la page', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'itilObjects');

    monterPage(<ItilObjectsPage kind="problem" />, { droits: DROITS });
    await screen.findByText('Lenteurs récurrentes');

    await utilisateur.type(screen.getByPlaceholderText(/Recherche/i), 'réseau');

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith('problem', { search: 'réseau' });
    });
  });

  it('crée un objet avec des sévérités moyennes par défaut', async () => {
    const utilisateur = userEvent.setup();
    const creer = vi.spyOn(api, 'createItilObject').mockResolvedValue(
      // Le detail complet n'est pas relu par l'ecran : seule la reussite
      // referme le formulaire et relance la liste.
      PROBLEMES[0] as never,
    );

    monterPage(<ItilObjectsPage kind="problem" />, { droits: DROITS });
    await screen.findByText('Lenteurs récurrentes');

    await utilisateur.click(screen.getByRole('button', { name: /Nouveau problème/ }));
    await utilisateur.type(await screen.findByLabelText(/Nom|Titre/), 'Saturation disque');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    // Urgence et impact a 3 : un objet cree sans arbitrage ne doit ni monter
    // ni descendre les files d'attente.
    await waitFor(() => {
      expect(creer).toHaveBeenCalledWith(
        'problem',
        expect.objectContaining({ name: 'Saturation disque', urgency: 3, impact: 3 }),
      );
    });
  });

  it('refuse d’envoyer un objet sans titre', async () => {
    const utilisateur = userEvent.setup();
    const creer = vi.spyOn(api, 'createItilObject');

    monterPage(<ItilObjectsPage kind="problem" />, { droits: DROITS });
    await screen.findByText('Lenteurs récurrentes');

    await utilisateur.click(screen.getByRole('button', { name: /Nouveau problème/ }));
    await utilisateur.click(await screen.findByRole('button', { name: 'Enregistrer' }));

    expect(creer).not.toHaveBeenCalled();
  });

  it('annonce une liste vide plutôt que de laisser la page muette', async () => {
    vi.spyOn(api, 'itilObjects').mockResolvedValue([]);

    monterPage(<ItilObjectsPage kind="problem" />, { droits: DROITS });

    expect(await screen.findByText(/Aucun problème/)).toBeInTheDocument();
  });

  it('n’efface pas la liste quand le serveur refuse', async () => {
    vi.spyOn(api, 'itilObjects').mockRejectedValue(new ApiError(403, 'Interdit'));

    monterPage(<ItilObjectsPage kind="problem" />, { droits: DROITS });

    // L'ecran reste monte : un refus n'est pas une panne du navigateur, et le
    // titre doit rester pour que l'on sache ou l'on est.
    expect(await screen.findByRole('heading', { name: /Problèmes/ })).toBeInTheDocument();
  });
});
