import type { Group, UserSummary } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { GroupsPage } from './GroupsPage';

/**
 * Groupes et appartenances.
 *
 * Un groupe porte deux drapeaux qui n'ont rien à voir : **demandeur** le rend
 * choisissable comme origine d'une demande, **attribuable** comme destinataire
 * du travail. Les confondre remplirait la liste des files de traitement avec
 * des services qui ne traitent rien.
 *
 * Les membres, eux, s'ajoutent et se retirent sans passer par le formulaire du
 * groupe : c'est un geste courant, et le faire transiter par une édition
 * complète obligerait à enregistrer un groupe pour y verser une personne.
 */

const GROUPES: Group[] = [
  {
    id: 1,
    name: 'Support N1',
    completeName: 'Support N1',
    comment: 'Premier niveau',
    entityId: 1,
    entityName: 'Racine',
    isRecursive: true,
    isRequester: false,
    isAssignable: true,
    members: [
      { userId: 10, displayName: 'Léa Moreau', isManager: true, isDynamic: false },
      { userId: 11, displayName: 'Thomas Petit', isManager: false, isDynamic: false },
    ],
  },
  {
    id: 2,
    name: 'Comptabilité',
    completeName: 'Comptabilité',
    comment: null,
    entityId: 1,
    entityName: 'Racine',
    isRecursive: false,
    isRequester: true,
    isAssignable: false,
    members: [],
  },
];

const COMPTES: UserSummary[] = [
  {
    id: 12,
    username: 'sophie',
    displayName: 'Sophie Bernard',
    email: null,
    authSource: 'local',
    isActive: true,
    locale: 'fr',
    lastLoginAt: null,
    authorizationCount: 1,
    groups: [],
  },
];

const DROITS = tousDroits(['group']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'groups').mockResolvedValue(GROUPES);
  vi.spyOn(api, 'users').mockResolvedValue(COMPTES);
});

describe('GroupsPage', () => {
  it('liste les groupes, leurs membres et leurs responsables', async () => {
    monterPage(<GroupsPage />, { droits: DROITS });

    expect(await screen.findByText('Support N1')).toBeInTheDocument();
    expect(screen.getByText('Léa Moreau')).toBeInTheDocument();

    // Le responsable se distingue : c'est lui qu'on sollicite quand une
    // validation traine, et rien d'autre ne le designe.
    expect(screen.getByText(/Responsable/)).toBeInTheDocument();
  });

  it('annonce un groupe sans membre', async () => {
    monterPage(<GroupsPage />, { droits: DROITS });

    await screen.findByText('Comptabilité');

    // Un groupe vide attribuable est une file ou personne ne travaille : le
    // dire evite d'y router des tickets qui n'iront nulle part.
    expect(screen.getByText('Aucun membre.')).toBeInTheDocument();
  });

  it('signale la portée récursive', async () => {
    monterPage(<GroupsPage />, { droits: DROITS });

    await screen.findByText('Support N1');

    // Un groupe recursif vaut aussi dans les sous-entites : sans le signal, on
    // le recree plus bas en croyant qu'il manque. « Comptabilite », qui ne
    // l'est pas, ne le porte donc pas.
    expect(screen.getByText('Utilisable dans la descendance')).toBeInTheDocument();
  });

  it('ajoute un membre sans passer par l’édition du groupe', async () => {
    const utilisateur = userEvent.setup();
    const ajouter = vi.spyOn(api, 'addMember').mockResolvedValue(GROUPES[0]!);

    monterPage(<GroupsPage />, { droits: DROITS });
    await screen.findByText('Support N1');

    const listes = screen.getAllByRole('combobox');

    await utilisateur.selectOptions(listes[0]!, '12');
    await utilisateur.click(screen.getAllByRole('button', { name: 'Ajouter' })[0]!);

    // Verser une personne dans un groupe est un geste courant : le faire
    // passer par un enregistrement complet du groupe serait disproportionne.
    await waitFor(() => {
      expect(ajouter).toHaveBeenCalledWith(1, { userId: 12, isManager: false });
    });
  });

  it('retire un membre', async () => {
    const utilisateur = userEvent.setup();
    const retirer = vi.spyOn(api, 'removeMember').mockResolvedValue(GROUPES[0]!);

    monterPage(<GroupsPage />, { droits: DROITS });
    await screen.findByText('Léa Moreau');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Retirer' })[0]!);

    await waitFor(() => {
      expect(retirer).toHaveBeenCalledWith(1, 10);
    });
  });

  it('crée un groupe avec ses deux rôles distincts', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveGroup').mockResolvedValue(GROUPES[0]!);

    monterPage(<GroupsPage />, { droits: DROITS });
    await screen.findByText('Support N1');

    await utilisateur.click(screen.getByRole('button', { name: /Nouveau groupe/ }));
    await utilisateur.type(await screen.findByLabelText('Nom'), 'Support N2');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    // « Demandeur » et « attribuable » sont deux roles independants : les
    // confondre remplirait les files de traitement de services qui ne traitent
    // rien.
    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Support N2', isRequester: true, isAssignable: true }),
        undefined,
      );
    });
  });

  it('cache la création et la suppression à qui n’en a pas le droit', async () => {
    monterPage(<GroupsPage />, { droits: { 'group:read': 'all' } });

    await screen.findByText('Support N1');

    expect(screen.queryByRole('button', { name: /Nouveau groupe/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveGroup').mockRejectedValue(new ApiError(409, 'Nom deja pris.'));

    monterPage(<GroupsPage />, { droits: DROITS });
    await screen.findByText('Support N1');

    await utilisateur.click(screen.getByRole('button', { name: /Nouveau groupe/ }));
    await utilisateur.type(await screen.findByLabelText('Nom'), 'Support N1');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Nom deja pris.')).toBeInTheDocument();
  });

  it('refuse l’écran à qui n’a pas le droit de lire', async () => {
    vi.spyOn(api, 'groups').mockRejectedValue(new ApiError(403, 'Interdit'));

    monterPage(<GroupsPage />, { droits: DROITS });

    expect(await screen.findByText(/ne permet pas/i)).toBeInTheDocument();
  });
});
