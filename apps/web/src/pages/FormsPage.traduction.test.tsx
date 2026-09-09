import type { Form, SessionContext } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { SessionProvider } from '@/lib/session';
import { rendre } from '@/test/rendu';
import { FormsPage } from './FormsPage';

/**
 * La saisie des traductions dans le constructeur de formulaires.
 *
 * Un formulaire de libre-service est lu par des demandeurs, pas par des
 * administrateurs : ses libellés doivent pouvoir exister dans la langue du
 * lecteur. Le stockage existait, l'écran pour le remplir non — la
 * fonctionnalité était donc inatteignable depuis le produit.
 *
 * Ce que ces tests tiennent, c'est ce que le rendu ne dit pas : que la saisie
 * reste masquée pour la majorité qui n'en a pas besoin, que la langue proposée
 * est celle qui manque au rédacteur, et qu'un champ qu'on vide **retire** la
 * traduction au lieu d'en enregistrer une vide — laquelle afficherait un
 * libellé blanc là où l'absence fait retomber sur l'original.
 */

const FORMULAIRE: Form = {
  id: 1,
  name: 'Demande de materiel',
  translations: [],
  description: null,
  category: null,
  isActive: true,
  ranking: 100,
  entityId: 1,
  entityName: 'Racine',
  isRecursive: true,
  sections: [
    {
      name: 'Votre besoin',
      translations: [],
      description: null,
      questions: [
        {
          kind: 'text',
          label: 'Quel materiel ?',
          translations: [],
          description: null,
          isRequired: false,
          options: [],
          defaultValue: null,
          conditions: [],
        },
      ],
    },
  ],
  access: [],
  destinations: [{ kind: 'ticket', mappings: [] }],
};

const SESSION = {
  user: { id: 1, username: 'admin', displayName: 'Alice Martin', email: null, locale: 'fr' },
  entity: { id: 1, name: 'Racine', completeName: 'Racine', path: 'e1', level: 0, parentId: null },
  profile: { id: 1, name: 'Admin', interface: 'standard' },
  includeSubEntities: true,
  rights: { 'form:read': 'all', 'form:update': 'all', 'form:create': 'all' },
  available: [],
} as SessionContext;

function monter() {
  return rendre(
    <SessionProvider session={SESSION}>
      <FormsPage />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'forms').mockResolvedValue([FORMULAIRE]);
  vi.spyOn(api, 'groups').mockResolvedValue([]);
  vi.spyOn(api, 'users').mockResolvedValue([]);
  vi.spyOn(api, 'itilCategories').mockResolvedValue([]);
});

describe('FormsPage — traductions', () => {
  it('ne montre aucun champ de traduction tant que la bascule est fermée', async () => {
    const utilisateur = userEvent.setup();

    monter();
    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier' }));

    expect(screen.queryByPlaceholderText('Traduction (English)')).not.toBeInTheDocument();
  });

  it('propose la langue qui manque au rédacteur, pas la sienne', async () => {
    const utilisateur = userEvent.setup();

    monter();
    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier' }));
    await utilisateur.click(screen.getByLabelText('Afficher les traductions'));

    // La session est en francais : c'est l'anglais qu'il reste a ecrire.
    expect(screen.getAllByPlaceholderText('Traduction (English)').length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText('Traduction (Français)')).not.toBeInTheDocument();
  });

  it('enregistre la traduction sous la langue visée', async () => {
    const utilisateur = userEvent.setup();
    const saveForm = vi.spyOn(api, 'saveForm').mockResolvedValue(FORMULAIRE);

    monter();
    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier' }));
    await utilisateur.click(screen.getByLabelText('Afficher les traductions'));

    // Le premier champ de traduction est celui du nom du formulaire.
    await utilisateur.type(
      screen.getAllByPlaceholderText('Traduction (English)')[0]!,
      'Equipment request',
    );
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(saveForm).toHaveBeenCalledWith(
        expect.objectContaining({
          translations: [{ locale: 'en', label: 'Equipment request', description: null }],
        }),
        1,
      );
    });
  });

  it('retire la traduction quand on vide le champ, au lieu d’en garder une vide', async () => {
    const utilisateur = userEvent.setup();
    const saveForm = vi.spyOn(api, 'saveForm').mockResolvedValue(FORMULAIRE);

    vi.spyOn(api, 'forms').mockResolvedValue([
      {
        ...FORMULAIRE,
        translations: [{ locale: 'en', label: 'Equipment request', description: null }],
      },
    ]);

    monter();
    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier' }));
    await utilisateur.click(screen.getByLabelText('Afficher les traductions'));

    const nom = screen.getAllByPlaceholderText('Traduction (English)')[0]!;
    expect(nom).toHaveValue('Equipment request');

    await utilisateur.clear(nom);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(saveForm).toHaveBeenCalledWith(expect.objectContaining({ translations: [] }), 1);
    });
  });
});
