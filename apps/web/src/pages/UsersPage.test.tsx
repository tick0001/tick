import type { EntitySummary, Profile, UserDetail, UserSummary } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { UsersPage } from './UsersPage';

/**
 * Comptes et habilitations.
 *
 * Un compte sans habilitation ne peut pas se connecter — c'est la faute la plus
 * facile à commettre en créant un utilisateur, et la plus difficile à
 * diagnostiquer ensuite, puisque le mot de passe est bon et que la connexion
 * échoue quand même. L'écran doit donc la signaler, et ces tests le vérifient.
 *
 * Les habilitations posées par un annuaire se distinguent aussi des autres :
 * elles se révoquent toutes seules à la synchronisation suivante, et les
 * retirer à la main ne tient pas.
 */

function compte(
  id: number,
  identifiant: string,
  surcharge: Partial<UserSummary> = {},
): UserSummary {
  return {
    id,
    username: identifiant,
    displayName: identifiant,
    email: `${identifiant}@exemple.fr`,
    authSource: 'local',
    isActive: true,
    locale: 'fr',
    lastLoginAt: null,
    authorizationCount: 1,
    groups: [],
    ...surcharge,
  };
}

const COMPTES: UserSummary[] = [
  compte(1, 'alice', { displayName: 'Alice Martin', groups: ['Support N1'] }),
  // Sans habilitation : ce compte ne peut pas se connecter.
  compte(2, 'orphelin', { displayName: 'Compte orphelin', authorizationCount: 0 }),
  compte(3, 'annuaire', { displayName: 'Compte annuaire', authSource: 'ldap' }),
];

const DETAIL: UserDetail = {
  ...compte(1, 'alice', { displayName: 'Alice Martin' }),
  firstName: 'Alice',
  lastName: 'Martin',
  authorizations: [
    {
      entityId: 1,
      entityName: 'Racine',
      profileId: 1,
      profileName: 'Administrateur',
      isRecursive: true,
      isDynamic: false,
    },
    {
      entityId: 2,
      entityName: 'DSI',
      profileId: 2,
      profileName: 'Technicien',
      isRecursive: false,
      // Posee par une regle d'annuaire.
      isDynamic: true,
    },
  ],
};

const PROFILS: Profile[] = [
  {
    id: 1,
    name: 'Administrateur',
    interface: 'standard',
    isDefault: false,
    comment: null,
    rights: [],
    usageCount: 3,
  },
  {
    id: 2,
    name: 'Technicien',
    interface: 'standard',
    isDefault: true,
    comment: null,
    rights: [],
    usageCount: 5,
  },
];

const ENTITES: EntitySummary[] = [
  { id: 1, name: 'Racine', completeName: 'Racine', path: 'e1', level: 0, parentId: null },
];

const DROITS = tousDroits(['user']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'users').mockResolvedValue(COMPTES);
  vi.spyOn(api, 'user').mockResolvedValue(DETAIL);
  vi.spyOn(api, 'profiles').mockResolvedValue(PROFILS);
  vi.spyOn(api, 'entities').mockResolvedValue(ENTITES);
});

describe('UsersPage', () => {
  it('liste les comptes avec leur origine et leurs groupes', async () => {
    monterPage(<UsersPage />, { droits: DROITS });

    expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
    expect(screen.getByText('Support N1')).toBeInTheDocument();

    // L'origine decide de ce qui est modifiable : un compte d'annuaire ne se
    // renomme pas ici, la prochaine synchronisation ecraserait la retouche.
    expect(screen.getByText('Annuaire')).toBeInTheDocument();
  });

  it('signale un compte sans habilitation', async () => {
    monterPage(<UsersPage />, { droits: DROITS });

    await screen.findByText('Compte orphelin');

    // Le mot de passe est bon et la connexion echoue quand meme : sans ce
    // signal, on cherche du cote de l'authentification.
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('cherche côté serveur plutôt que de filtrer la page', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'users');

    monterPage(<UsersPage />, { droits: DROITS });
    await screen.findByText('Alice Martin');

    await utilisateur.type(screen.getByPlaceholderText('Utilisateurs'), 'ali');

    // Filtrer cote client obligerait a transporter tous les comptes pour en
    // jeter la plupart, et ne trouverait jamais au-dela de la premiere page.
    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith({ search: 'ali', inactive: false });
    });
  });

  it('inclut les comptes désactivés sur demande', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'users');

    monterPage(<UsersPage />, { droits: DROITS });
    await screen.findByText('Alice Martin');

    await utilisateur.click(screen.getByRole('checkbox', { name: /désactivés/i }));

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith({ search: undefined, inactive: true });
    });
  });

  it('ouvre le détail d’un compte et distingue les habilitations d’annuaire', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<UsersPage />, { droits: DROITS });
    await screen.findByText('Alice Martin');

    await utilisateur.click(screen.getByRole('button', { name: 'Alice Martin' }));

    // L'entite accompagne le profil : « Administrateur » seul ne dit pas sur
    // quelle branche le compte l'est.
    expect(await screen.findByText(/Habilitations — Alice Martin/)).toBeInTheDocument();
    expect(screen.getByText(/DSI/)).toBeInTheDocument();

    // Une habilitation dynamique se revoque toute seule : la retirer a la main
    // ne tient pas jusqu'a la synchronisation suivante. Elle porte donc sa
    // provenance, la posee a la main non.
    const habilitations = screen.getAllByRole('listitem');
    const dynamique = habilitations.find((ligne) => ligne.textContent?.includes('DSI'))!;
    const manuelle = habilitations.find((ligne) => ligne.textContent?.includes('Racine'))!;

    expect(dynamique.textContent).toMatch(/annuaire/);
    expect(manuelle.textContent).not.toMatch(/annuaire/);
  });

  it('accorde une habilitation depuis le détail', async () => {
    const utilisateur = userEvent.setup();
    const accorder = vi.spyOn(api, 'grant').mockResolvedValue(DETAIL.authorizations);

    monterPage(<UsersPage />, { droits: DROITS });
    await screen.findByText('Alice Martin');

    await utilisateur.click(screen.getByRole('button', { name: 'Alice Martin' }));

    const bouton = await screen.findByRole('button', { name: 'Accorder' });

    // Tant que l'entite et le profil ne sont pas choisis, il n'y a rien a
    // accorder : le bouton reste ferme plutot que d'envoyer une habilitation
    // incomplete que le serveur refusera.
    expect(bouton).toBeDisabled();

    await utilisateur.selectOptions(await screen.findByLabelText('Entités'), '1');
    await utilisateur.selectOptions(screen.getByLabelText('Profils et droits'), '2');
    await utilisateur.click(bouton);

    await waitFor(() => {
      expect(accorder).toHaveBeenCalledWith(1, {
        entityId: 1,
        profileId: 2,
        isRecursive: true,
      });
    });
  });

  it('cache la création à qui n’a pas le droit', async () => {
    monterPage(<UsersPage />, { droits: { 'user:read': 'all' } });

    await screen.findByText('Alice Martin');

    expect(screen.queryByRole('button', { name: 'Nouvel utilisateur' })).not.toBeInTheDocument();
  });

  it('crée un compte', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveUser').mockResolvedValue(DETAIL);

    monterPage(<UsersPage />, { droits: DROITS });
    await screen.findByText('Alice Martin');

    await utilisateur.click(screen.getByRole('button', { name: 'Nouvel utilisateur' }));
    await utilisateur.type(await screen.findByLabelText('Identifiant'), 'nouveau');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'nouveau', isActive: true }),
        undefined,
      );
    });
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveUser').mockRejectedValue(new ApiError(409, 'Identifiant deja pris.'));

    monterPage(<UsersPage />, { droits: DROITS });
    await screen.findByText('Alice Martin');

    await utilisateur.click(screen.getByRole('button', { name: 'Nouvel utilisateur' }));
    await utilisateur.type(await screen.findByLabelText('Identifiant'), 'alice');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Identifiant deja pris.')).toBeInTheDocument();
  });
});
