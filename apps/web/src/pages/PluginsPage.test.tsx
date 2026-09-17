import type { PluginSettingsView, PluginStatus } from '@tick/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { PluginsPage } from './PluginsPage';

/**
 * Extensions.
 *
 * Deux choses comptent plus que le reste. L'écran dit ce qu'un plugin
 * **demande** avant qu'on l'installe — c'est tout l'intérêt de déclarer ses
 * permissions. Et un secret n'y reparaît jamais : l'API ne le renvoie pas, et
 * un enregistrement qui n'y touche pas ne doit pas l'effacer.
 */

const MESSAGERIE: PluginStatus = {
  id: 'messagerie',
  name: 'Notifications vers une messagerie',
  version: '1.0.0',
  state: 'actif',
  sdkRange: '^0.8.0',
  compatible: true,
  hasClient: false,
  lastError: null,
  description: 'Relaie les tickets vers un canal de discussion.',
  permissions: ['events', 'http:outbound'],
  hasSettings: true,
};

const NEUF: PluginStatus = {
  ...MESSAGERIE,
  id: 'neuf',
  name: 'Plugin neuf',
  state: 'decouvert',
  permissions: [],
  hasSettings: false,
  description: null,
};

const INSTANCE: PluginSettingsView = {
  pluginId: 'messagerie',
  entityId: null,
  settings: [
    {
      key: 'format',
      label: 'Format des messages',
      description: null,
      type: 'enum',
      scope: 'instance',
      options: ['slack', 'teams'],
      min: null,
      max: null,
      default: 'slack',
      value: null,
      isSet: false,
      inherited: null,
    },
  ],
};

const SITE: PluginSettingsView = {
  pluginId: 'messagerie',
  entityId: 7,
  settings: [
    {
      key: 'webhook',
      label: 'Adresse du webhook',
      description: null,
      type: 'secret',
      scope: 'entity',
      options: null,
      min: null,
      max: null,
      default: null,
      value: null,
      isSet: true,
      inherited: null,
    },
    {
      key: 'canal',
      label: 'Canal',
      description: null,
      type: 'text',
      scope: 'entity',
      options: null,
      min: null,
      max: null,
      default: null,
      value: null,
      isSet: false,
      inherited: { fromEntityId: 1, fromEntityName: 'Racine', value: 'support' },
    },
  ],
};

const DROITS = tousDroits(['plugin']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'plugins').mockResolvedValue([MESSAGERIE, NEUF]);
  vi.spyOn(api, 'entities').mockResolvedValue([
    {
      id: 7,
      name: 'Site A',
      completeName: 'Racine > Site A',
      path: 'e1.e7',
      level: 1,
      parentId: 1,
    },
  ]);
  vi.spyOn(api, 'pluginSettings').mockImplementation((_id, entite) =>
    Promise.resolve(entite === null ? INSTANCE : SITE),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function ouvrirReglages(utilisateur: ReturnType<typeof userEvent.setup>) {
  monterPage(<PluginsPage />, { droits: DROITS });
  await utilisateur.click(await screen.findByRole('button', { name: 'Réglages' }));
}

/** Choisit l'entité, une fois la liste chargée. */
async function choisirSiteA(utilisateur: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: 'Racine > Site A' });
  await utilisateur.selectOptions(screen.getByRole('combobox', { name: 'S’applique à' }), '7');
}

describe('PluginsPage', () => {
  it('dit ce qu un plugin demande avant qu on l installe', async () => {
    monterPage(<PluginsPage />, { droits: DROITS });

    const carte = (await screen.findByText('Notifications vers une messagerie')).closest('div');

    expect(carte?.parentElement).toBeTruthy();
    expect(screen.getByText('Réagir aux événements')).toBeInTheDocument();
    expect(screen.getByText('Joindre des services externes')).toBeInTheDocument();
    expect(screen.getByText('Rien de particulier.')).toBeInTheDocument();
  });

  it('propose l action qui convient a l etat', async () => {
    const utilisateur = userEvent.setup();
    const agir = vi.spyOn(api, 'pluginAction').mockResolvedValue();

    monterPage(<PluginsPage />, { droits: DROITS });

    await utilisateur.click(await screen.findByRole('button', { name: 'Installer' }));
    await waitFor(() => {
      expect(agir).toHaveBeenCalledWith('neuf', 'install');
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Désactiver' }));
    await waitFor(() => {
      expect(agir).toHaveBeenCalledWith('messagerie', 'deactivate');
    });
  });

  it('signale un plugin incompatible et refuse de l installer', async () => {
    vi.spyOn(api, 'plugins').mockResolvedValue([{ ...NEUF, compatible: false }]);

    monterPage(<PluginsPage />, { droits: DROITS });

    expect(await screen.findByText(/Demande le SDK \^0\.8\.0/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Installer' })).toBeDisabled();
  });

  it('demande confirmation avant de desinstaller, et s abstient sinon', async () => {
    const utilisateur = userEvent.setup();
    const desinstaller = vi.spyOn(api, 'uninstallPlugin').mockResolvedValue();
    const confirmer = vi.fn().mockReturnValue(false);

    vi.stubGlobal('confirm', confirmer);

    vi.spyOn(api, 'plugins').mockResolvedValue([{ ...MESSAGERIE, state: 'inactif' }]);
    monterPage(<PluginsPage />, { droits: DROITS });

    await utilisateur.click(await screen.findByRole('button', { name: 'Désinstaller' }));

    expect(confirmer).toHaveBeenCalledWith(expect.stringContaining('définitivement'));
    expect(desinstaller).not.toHaveBeenCalled();
  });

  it('ne propose aucune action sans droit de modification', async () => {
    monterPage(<PluginsPage />, { droits: { 'plugin:read': 'all' } });

    await screen.findByText('Notifications vers une messagerie');

    expect(screen.queryByRole('button', { name: 'Installer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Désinstaller' })).not.toBeInTheDocument();
  });

  describe('reglages', () => {
    it('montre les reglages d instance et leur valeur par defaut', async () => {
      const utilisateur = userEvent.setup();

      await ouvrirReglages(utilisateur);

      expect(await screen.findByText('Format des messages')).toBeInTheDocument();
      expect(screen.getByText('Par défaut : slack')).toBeInTheDocument();
    });

    it('n envoie que ce qui a ete touche', async () => {
      const utilisateur = userEvent.setup();
      const enregistrer = vi.spyOn(api, 'savePluginSettings').mockResolvedValue();

      await ouvrirReglages(utilisateur);
      await utilisateur.selectOptions(
        await screen.findByRole('combobox', { name: 'Format des messages' }),
        'teams',
      );
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        expect(enregistrer).toHaveBeenCalledWith('messagerie', {
          entityId: null,
          values: { format: 'teams' },
        });
      });
      expect(await screen.findByText('Réglages enregistrés.')).toBeInTheDocument();
    });

    it('ne montre jamais un secret, et ne l efface pas quand on n y touche pas', async () => {
      const utilisateur = userEvent.setup();
      const enregistrer = vi.spyOn(api, 'savePluginSettings').mockResolvedValue();

      await ouvrirReglages(utilisateur);
      await choisirSiteA(utilisateur);

      const secret = await screen.findByLabelText('Adresse du webhook');

      expect(secret).toHaveValue('');
      expect(secret).toHaveAttribute('type', 'password');
      expect(screen.getByText(/Un secret est enregistré/)).toBeInTheDocument();

      await utilisateur.type(screen.getByRole('textbox', { name: 'Canal' }), 'incidents');
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        expect(enregistrer).toHaveBeenCalledWith('messagerie', {
          entityId: 7,
          values: { canal: 'incidents' },
        });
      });
    });

    it('dit d ou vient une valeur heritee', async () => {
      const utilisateur = userEvent.setup();

      await ouvrirReglages(utilisateur);
      await choisirSiteA(utilisateur);

      expect(await screen.findByText('Hérité de Racine : support')).toBeInTheDocument();
    });

    it('retire une valeur en envoyant null', async () => {
      const utilisateur = userEvent.setup();
      const enregistrer = vi.spyOn(api, 'savePluginSettings').mockResolvedValue();

      await ouvrirReglages(utilisateur);
      await choisirSiteA(utilisateur);

      const bloc = (await screen.findByLabelText('Adresse du webhook')).closest('div')
        ?.parentElement as HTMLElement;

      await utilisateur.click(within(bloc).getByRole('button', { name: 'Retirer' }));
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        expect(enregistrer).toHaveBeenCalledWith('messagerie', {
          entityId: 7,
          values: { webhook: null },
        });
      });
    });
  });
});
