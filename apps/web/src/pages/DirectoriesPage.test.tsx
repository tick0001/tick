import type { LdapDirectory } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { DirectoriesPage } from './DirectoriesPage';

/**
 * Annuaires LDAP.
 *
 * Le mot de passe du compte de service n'est **jamais** renvoyé par l'API :
 * seule sa présence l'est. L'écran doit donc dire « un mot de passe est
 * enregistré » sans jamais le remettre en circulation, et un enregistrement qui
 * ne touche pas au champ ne doit pas l'effacer — c'est la faute qui casserait
 * l'authentification de tout le monde d'un coup.
 *
 * L'essai de connexion existe pour la même raison : sans lui, on ne découvre
 * une configuration fausse qu'au moment où plus personne ne se connecte.
 */

const ANNUAIRE: LdapDirectory = {
  id: 1,
  name: 'Annuaire principal',
  host: 'ldap.exemple.fr',
  port: 389,
  useTls: false,
  bindDn: 'cn=service,dc=exemple,dc=fr',
  // Le mot de passe n'est pas renvoye : seule sa presence l'est.
  hasBindPassword: true,
  baseDn: 'dc=exemple,dc=fr',
  userFilter: '(objectClass=person)',
  loginAttribute: 'uid',
  emailAttribute: 'mail',
  firstNameAttribute: 'givenName',
  lastNameAttribute: 'sn',
  groupSearchMode: 'memberof',
  memberOfAttribute: 'memberOf',
  groupMemberAttribute: 'member',
  groupBaseDn: null,
  groupFilter: '(objectClass=groupOfNames)',
  isActive: true,
  isDefault: true,
  timeoutMs: 5000,
  lastSyncAt: null,
};

const DROITS = tousDroits(['ldap']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'directories').mockResolvedValue([ANNUAIRE]);
});

describe('DirectoriesPage', () => {
  it('affiche la configuration sans jamais montrer le mot de passe', async () => {
    monterPage(<DirectoriesPage />, { droits: DROITS });

    expect(await screen.findByText('Annuaire principal')).toBeInTheDocument();
    expect(screen.getByText(/ldap\.exemple\.fr/)).toBeInTheDocument();

    // Sa presence est annoncee, sa valeur jamais : l'API ne la renvoie pas, et
    // l'ecran ne doit pas la remettre en circulation.
    expect(screen.getByText(/mot de passe/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/secret/)).not.toBeInTheDocument();
  });

  it('n’envoie pas de mot de passe quand on n’y touche pas', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveDirectory').mockResolvedValue(ANNUAIRE);

    monterPage(<DirectoriesPage />, { droits: DROITS });
    await screen.findByText('Annuaire principal');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    const nom = await screen.findByDisplayValue('Annuaire principal');

    await utilisateur.clear(nom);
    await utilisateur.type(nom, 'Annuaire renommé');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalled();
    });

    // Envoyer une chaine vide effacerait le mot de passe enregistre, et plus
    // personne ne se connecterait.
    const [corps] = enregistrer.mock.calls[0]!;

    expect(corps.name).toBe('Annuaire renommé');
    expect(corps.bindPassword).toBeUndefined();
  });

  it('rend compte d’un essai de connexion réussi', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'testDirectory').mockResolvedValue({
      ok: true,
      message: 'Liaison ok',
      found: 42,
    });

    monterPage(<DirectoriesPage />, { droits: DROITS });
    await screen.findByText('Annuaire principal');

    await utilisateur.click(screen.getByRole('button', { name: /Tester la connexion/ }));

    // Le nombre de comptes trouves compte autant que la liaison : une base de
    // recherche fausse repond « ok » avec zero compte.
    expect(await screen.findByText(/Liaison établie/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it('rend compte d’un essai qui échoue, avec sa cause', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'testDirectory').mockResolvedValue({
      ok: false,
      message: 'Identifiants refuses',
      found: null,
    });

    monterPage(<DirectoriesPage />, { droits: DROITS });
    await screen.findByText('Annuaire principal');

    await utilisateur.click(screen.getByRole('button', { name: /Tester la connexion/ }));

    expect(await screen.findByText(/Identifiants refuses/)).toBeInTheDocument();
  });

  it('cache la création à qui n’a pas le droit d’écrire', async () => {
    monterPage(<DirectoriesPage />, { droits: { 'ldap:read': 'all' } });

    await screen.findByText('Annuaire principal');

    expect(screen.queryByRole('button', { name: 'Nouvel annuaire' })).not.toBeInTheDocument();
  });

  it('annonce l’absence d’annuaire plutôt que de laisser la page vide', async () => {
    vi.spyOn(api, 'directories').mockResolvedValue([]);

    monterPage(<DirectoriesPage />, { droits: DROITS });

    // « Aucun annuaire » ne suffit pas : il faut dire ce qui se passe alors,
    // sinon on croit l'authentification cassee.
    expect(await screen.findByText(/authentification reste locale/i)).toBeInTheDocument();
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveDirectory').mockRejectedValue(new ApiError(400, 'Hote injoignable.'));

    monterPage(<DirectoriesPage />, { droits: DROITS });
    await screen.findByText('Annuaire principal');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Hote injoignable.')).toBeInTheDocument();
  });
});
