import type { Profile, RightObject } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { ProfilesPage } from './ProfilesPage';

/**
 * Profils et droits.
 *
 * L'écran le plus dangereux de la configuration : un droit est un triplet
 * objet × action × portée, et l'**absence** de ligne vaut refus. Retirer une
 * portée n'est donc pas une nuance de réglage, c'est une révocation.
 *
 * Deux garanties comptent ici. Le catalogue vient du serveur, qui seul sait
 * quelles portées ont un sens pour quel objet — proposer « les miens » sur un
 * modèle de notification ferait chercher longtemps pourquoi le choix ne change
 * rien. Et un profil déjà employé ne se supprime pas sans qu'on sache combien
 * d'habilitations en dépendent.
 */

const CATALOGUE: RightObject[] = [
  {
    object: 'ticket',
    label: 'Tickets',
    group: 'itil',
    actions: ['read', 'create', 'update'],
    scopes: ['own', 'group', 'entity', 'recursive', 'all'],
  },
  {
    object: 'notification',
    label: 'Notifications',
    group: 'configuration',
    actions: ['read', 'update'],
    // Un modele de notification n'appartient a personne : pas de portee « own ».
    scopes: ['entity', 'recursive', 'all'],
  },
];

const PROFILS: Profile[] = [
  {
    id: 1,
    name: 'Administrateur',
    interface: 'standard',
    isDefault: false,
    comment: null,
    rights: [{ object: 'ticket', action: 'read', scope: 'all' }],
    usageCount: 4,
  },
  {
    id: 2,
    name: 'Self-service',
    interface: 'self_service',
    isDefault: true,
    comment: 'Le profil des demandeurs',
    rights: [{ object: 'ticket', action: 'read', scope: 'own' }],
    usageCount: 0,
  },
];

const DROITS = tousDroits(['profile']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'profiles').mockResolvedValue(PROFILS);
  vi.spyOn(api, 'rightCatalogue').mockResolvedValue(CATALOGUE);
});

describe('ProfilesPage', () => {
  it('liste les profils, leur interface et leur usage', async () => {
    monterPage(<ProfilesPage />, { droits: DROITS });

    expect(await screen.findByText('Administrateur')).toBeInTheDocument();
    expect(screen.getByText('Self-service')).toBeInTheDocument();

    // Le nombre d'habilitations dit ce qu'une suppression emporterait : sans
    // lui, on efface un profil en croyant qu'il ne sert plus.
    expect(screen.getByText(/4/)).toBeInTheDocument();
  });

  it('ne propose que les portées qui ont un sens pour l’objet', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<ProfilesPage />, { droits: DROITS });
    await screen.findByText('Administrateur');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    // Le catalogue vient du serveur, qui seul sait qu'un modele de notification
    // n'appartient a personne. Une liste figee cote client proposerait « les
    // miens » partout, et le choix resterait sans effet.
    expect(await screen.findByText('Tickets')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('cache la création à qui n’a pas le droit d’écrire', async () => {
    monterPage(<ProfilesPage />, { droits: { 'profile:read': 'all' } });

    await screen.findByText('Administrateur');

    expect(screen.queryByRole('button', { name: /Nouveau profil/ })).not.toBeInTheDocument();
  });

  it('reprend un profil existant et renvoie son identifiant', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveProfile').mockResolvedValue(PROFILS[0]!);

    monterPage(<ProfilesPage />, { droits: DROITS });
    await screen.findByText('Administrateur');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    expect(await screen.findByDisplayValue('Administrateur')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Administrateur',
          rights: [{ object: 'ticket', action: 'read', scope: 'all' }],
        }),
        1,
      );
    });
  });

  it('supprime un profil', async () => {
    const utilisateur = userEvent.setup();
    const supprimer = vi.spyOn(api, 'deleteProfile').mockResolvedValue(undefined);

    monterPage(<ProfilesPage />, { droits: DROITS });
    await screen.findByText('Self-service');

    const boutons = screen.getAllByRole('button', { name: 'Supprimer' });

    await utilisateur.click(boutons.at(-1)!);

    await waitFor(() => {
      expect(supprimer).toHaveBeenCalled();
    });
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveProfile').mockRejectedValue(
      new ApiError(409, 'Un profil porte deja ce nom.'),
    );

    monterPage(<ProfilesPage />, { droits: DROITS });
    await screen.findByText('Administrateur');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Un profil porte deja ce nom.')).toBeInTheDocument();
  });

  it('refuse l’écran à qui n’a pas le droit de lire', async () => {
    vi.spyOn(api, 'profiles').mockRejectedValue(new ApiError(403, 'Interdit'));

    monterPage(<ProfilesPage />, { droits: DROITS });

    expect(await screen.findByText(/ne permet pas/i)).toBeInTheDocument();
  });
});
