import type { Form, SessionContext, UpsertForm } from '@tick/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { SessionProvider } from '@/lib/session';
import { rendre } from '@/test/rendu';
import { FormsPage } from './FormsPage';

/**
 * L'onglet « Destination » du constructeur de formulaires.
 *
 * Il répond à une question : **quel ticket ce formulaire produit-il ?** L'écran
 * présente donc les champs du ticket, tous, et dit pour chacun d'où sort sa
 * valeur — plutôt qu'une liste de correspondances qu'on ajoute une à une.
 *
 * Ce que ces tests tiennent, c'est ce qui n'est pas lisible dans le rendu :
 * qu'un champ ne peut plus être visé deux fois, et qu'un formulaire déjà
 * enregistré avec un doublon montre bien la correspondance qui gagne à la
 * soumission — la dernière, celle que le serveur retient.
 */

const FORMULAIRE: Form = {
  id: 1,
  name: 'Demande de materiel',
  description: null,
  category: 'Materiel',
  isActive: true,
  ranking: 100,
  entityId: 1,
  entityName: 'Racine',
  isRecursive: true,
  sections: [
    {
      name: 'Votre besoin',
      description: null,
      questions: [
        {
          kind: 'select',
          label: 'Quel materiel ?',
          description: null,
          isRequired: true,
          options: ['Ecran', 'Clavier'],
          defaultValue: null,
          conditions: [],
        },
        {
          kind: 'urgency',
          label: 'Dans quel delai ?',
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
  destinations: [
    {
      kind: 'ticket',
      mappings: [
        // Deux correspondances sur « urgence » : un formulaire enregistre avant
        // cet ecran a pu en porter, et c'est la seconde qui gagnait a la
        // soumission sans que rien ne le montre.
        { field: 'urgency', source: 'literal', question: null, value: '2' },
        { field: 'urgency', source: 'question', question: 1, value: null },
        { field: 'type', source: 'literal', question: null, value: 'request' },
      ],
    },
  ],
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

/** Ouvre le formulaire de démonstration sur son onglet « Destination ». */
async function ouvrirDestination(utilisateur: ReturnType<typeof userEvent.setup>): Promise<void> {
  await utilisateur.click(await screen.findByRole('button', { name: 'Modifier' }));
  await utilisateur.click(await screen.findByRole('tab', { name: 'Destination' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'forms').mockResolvedValue([FORMULAIRE]);
  vi.spyOn(api, 'groups').mockResolvedValue([]);
  vi.spyOn(api, 'users').mockResolvedValue([]);
  vi.spyOn(api, 'itilCategories').mockResolvedValue([]);
});

describe('FormsPage — destination', () => {
  it('présente tous les champs du ticket, groupés', async () => {
    const utilisateur = userEvent.setup();

    monter();
    await ouvrirDestination(utilisateur);

    expect(screen.getByText('Contenu')).toBeInTheDocument();
    expect(screen.getByText('Qualification')).toBeInTheDocument();
    expect(screen.getByText('Acteurs')).toBeInTheDocument();

    // Onze champs, y compris ceux que personne n'a encore regles : une liste
    // vide ne disait pas ce qu'on pouvait remplir.
    for (const champ of [
      'Sujet du ticket',
      'Description',
      'Type',
      'Urgence',
      'Impact',
      'Catégorie',
      'Groupe attribué',
      'Technicien attribué',
      'Observateur',
    ]) {
      expect(screen.getByLabelText(champ)).toBeInTheDocument();
    }
  });

  it('montre la correspondance qui gagne quand un champ en porte deux', async () => {
    const utilisateur = userEvent.setup();

    monter();
    await ouvrirDestination(utilisateur);

    // Le serveur affecte `sortie[mapping.field]` en parcourant la liste : c'est
    // la derniere qui reste. Montrer la premiere ferait mentir l'ecran.
    expect(screen.getByLabelText('Urgence')).toHaveValue('question');
    expect(screen.getByLabelText('Urgence — Réponse')).toHaveValue('1');
  });

  it('laisse un champ non visé sur « par défaut »', async () => {
    const utilisateur = userEvent.setup();

    monter();
    await ouvrirDestination(utilisateur);

    expect(screen.getByLabelText('Impact')).toHaveValue('defaut');
    expect(screen.queryByLabelText('Impact — Valeur fixe')).not.toBeInTheDocument();
  });

  it('remplace la correspondance d’un champ au lieu d’en ajouter une', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveForm').mockResolvedValue(FORMULAIRE);

    monter();
    await ouvrirDestination(utilisateur);

    await utilisateur.selectOptions(screen.getByLabelText('Urgence'), 'literal');
    await utilisateur.selectOptions(screen.getByLabelText('Urgence — Valeur fixe'), '4');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalled();
    });

    const envoye = enregistrer.mock.calls[0]?.[0] as UpsertForm;
    const urgences = envoye.destinations[0]?.mappings.filter((m) => m.field === 'urgency') ?? [];

    // Le doublon d'origine part avec : l'ecran ne peut plus en produire, et en
    // laisser trainer un rendrait l'enregistrement suivant illisible.
    expect(urgences).toEqual([
      { field: 'urgency', source: 'literal', question: null, value: '4' },
    ]);
  });

  it('retire la correspondance quand on repasse à « par défaut »', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveForm').mockResolvedValue(FORMULAIRE);

    monter();
    await ouvrirDestination(utilisateur);

    await utilisateur.selectOptions(screen.getByLabelText('Type'), 'defaut');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalled();
    });

    const envoye = enregistrer.mock.calls[0]?.[0] as UpsertForm;

    expect(envoye.destinations[0]?.mappings.some((m) => m.field === 'type')).toBe(false);
  });

  it('nomme les niveaux de sévérité au lieu de les numéroter', async () => {
    const utilisateur = userEvent.setup();

    monter();
    await ouvrirDestination(utilisateur);

    await utilisateur.selectOptions(screen.getByLabelText('Impact'), 'literal');

    // « 4 » seul obligeait a savoir de tete si l'echelle monte ou descend.
    // La recherche est portee sur le controle : l'apercu affiche la meme
    // echelle a droite, pour la question d'urgence du formulaire.
    const impact = screen.getByLabelText('Impact — Valeur fixe');

    expect(within(impact).getByRole('option', { name: 'Haute' })).toHaveValue('4');
  });
});
