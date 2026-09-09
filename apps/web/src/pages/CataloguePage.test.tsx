import type { Form, FormSummary } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage } from '@/test/page';
import { CataloguePage } from './CataloguePage';

/**
 * Le catalogue, vu par un demandeur.
 *
 * Trois comportements y méritent d'être tenus, et aucun n'est visible dans le
 * rendu.
 *
 * Les **conditions d'affichage** d'abord : une question ne s'affiche que si
 * celles dont elle dépend le sont aussi et répondent à ce qu'elle attend. Une
 * chaîne mal évaluée poserait une question hors contexte, ou en cacherait une
 * obligatoire — auquel cas la soumission échouerait sans que le demandeur voie
 * quoi corriger.
 *
 * Les **valeurs par défaut** ensuite, posées une fois le formulaire chargé :
 * au clic on ne connaît que son identifiant.
 *
 * Enfin les **référentiels absents** : un demandeur n'a pas le droit de lister
 * les comptes, et ce refus ne doit pas empêcher le formulaire de s'afficher.
 */

const SERVICES: FormSummary[] = [
  { id: 1, name: 'Demande de matériel', description: 'Écran, clavier', category: 'Matériel' },
  { id: 2, name: 'Accès applicatif', description: null, category: null },
];

const FORMULAIRE: Form = {
  id: 1,
  name: 'Demande de matériel',
  description: 'Ce dont vous avez besoin',
  category: 'Matériel',
  isActive: true,
  ranking: 100,
  entityId: 1,
  entityName: 'Racine',
  isRecursive: true,
  translations: [],
  access: [],
  destinations: [{ kind: 'ticket', mappings: [] }],
  sections: [
    {
      name: 'Votre besoin',
      translations: [],
      description: null,
      questions: [
        {
          kind: 'select',
          label: 'Quel matériel ?',
          translations: [],
          description: null,
          isRequired: true,
          options: ['Écran', 'Autre'],
          defaultValue: 'Écran',
          conditions: [],
        },
        {
          // Ne s'affiche que si la premiere reponse vaut « Autre ».
          kind: 'text',
          label: 'Précisez',
          translations: [],
          description: null,
          isRequired: false,
          options: [],
          defaultValue: null,
          conditions: [{ dependsOn: 0, operator: 'is', value: 'Autre' }],
        },
        {
          kind: 'user',
          label: 'Pour qui ?',
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
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'catalogue').mockResolvedValue(SERVICES);
  vi.spyOn(api, 'catalogueForm').mockResolvedValue(FORMULAIRE);
  vi.spyOn(api, 'groups').mockResolvedValue([]);
  vi.spyOn(api, 'itilCategories').mockResolvedValue([]);
  // Un demandeur n'a pas le droit de lister les comptes : le referentiel de la
  // question « Pour qui ? » revient donc vide, et ce n'est pas une panne.
  vi.spyOn(api, 'users').mockRejectedValue(new ApiError(403, 'Interdit'));
});

/** Ouvre le premier service du catalogue. */
async function ouvrir(utilisateur: ReturnType<typeof userEvent.setup>): Promise<void> {
  await utilisateur.click(await screen.findByRole('button', { name: /Demande de matériel/ }));
  await screen.findByText('Votre besoin');
}

describe('CataloguePage', () => {
  it('liste les services offerts, avec leur rubrique', async () => {
    monterPage(<CataloguePage />);

    expect(await screen.findByText('Demande de matériel')).toBeInTheDocument();
    expect(screen.getByText('Écran, clavier')).toBeInTheDocument();
    expect(screen.getByText('Matériel')).toBeInTheDocument();
    expect(screen.getByText('Accès applicatif')).toBeInTheDocument();
  });

  it('ouvre le formulaire choisi et pose ses valeurs par défaut', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<CataloguePage />);
    await ouvrir(utilisateur);

    expect(screen.getByText('Ce dont vous avez besoin')).toBeInTheDocument();

    // La valeur par defaut est posee apres chargement : au clic, on ne
    // connaissait que l'identifiant du formulaire.
    expect(screen.getByLabelText(/Quel matériel/)).toHaveValue('Écran');
  });

  it('n’affiche une question conditionnelle que lorsque sa condition est remplie', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<CataloguePage />);
    await ouvrir(utilisateur);

    expect(screen.queryByLabelText(/Précisez/)).not.toBeInTheDocument();

    await utilisateur.selectOptions(screen.getByLabelText(/Quel matériel/), 'Autre');

    expect(await screen.findByLabelText(/Précisez/)).toBeInTheDocument();

    // Et elle disparait de nouveau : une question restee visible apres coup
    // partirait avec une reponse que le demandeur croyait annulee.
    await utilisateur.selectOptions(screen.getByLabelText(/Quel matériel/), 'Écran');

    await waitFor(() => {
      expect(screen.queryByLabelText(/Précisez/)).not.toBeInTheDocument();
    });
  });

  it('s’affiche même quand un référentiel est refusé au demandeur', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<CataloguePage />);
    await ouvrir(utilisateur);

    // La question se rend sans choix plutot que d'empecher tout le formulaire
    // de s'afficher : le refus de lister les comptes n'est pas une panne.
    expect(screen.getByLabelText(/Pour qui/)).toBeInTheDocument();
  });

  it('envoie les réponses indexées par le rang de leur question', async () => {
    const utilisateur = userEvent.setup();
    const soumettre = vi
      .spyOn(api, 'submitForm')
      .mockResolvedValue({ submissionId: 7, ticketId: 42 });

    monterPage(<CataloguePage />);
    await ouvrir(utilisateur);

    await utilisateur.selectOptions(screen.getByLabelText(/Quel matériel/), 'Autre');
    await utilisateur.type(await screen.findByLabelText(/Précisez/), 'Station');
    await utilisateur.click(screen.getByRole('button', { name: /Envoyer/ }));

    // Le rang, et non l'identifiant de la question : un formulaire se compose
    // avant que ses questions existent en base.
    await waitFor(() => {
      expect(soumettre).toHaveBeenCalled();
    });

    const [identifiant, corps] = soumettre.mock.calls[0]!;

    expect(identifiant).toBe(1);
    expect(corps.answers['0']).toBe('Autre');
    expect(corps.answers['1']).toBe('Station');
  });

  it('revient au catalogue sans envoyer', async () => {
    const utilisateur = userEvent.setup();
    const soumettre = vi.spyOn(api, 'submitForm');

    monterPage(<CataloguePage />);
    await ouvrir(utilisateur);

    await utilisateur.click(screen.getByRole('button', { name: /Retour au catalogue/ }));

    expect(await screen.findByText('Accès applicatif')).toBeInTheDocument();
    expect(soumettre).not.toHaveBeenCalled();
  });

  it('montre le refus du serveur plutôt que de perdre la saisie', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'submitForm').mockRejectedValue(new ApiError(400, 'Reponse obligatoire.'));

    monterPage(<CataloguePage />);
    await ouvrir(utilisateur);

    await utilisateur.click(screen.getByRole('button', { name: /Envoyer/ }));

    expect(await screen.findByText('Reponse obligatoire.')).toBeInTheDocument();

    // Le formulaire reste a l'ecran : le renvoyer au catalogue effacerait ce
    // que le demandeur vient de saisir.
    expect(screen.getByLabelText(/Quel matériel/)).toBeInTheDocument();
  });

  it('annonce un catalogue vide plutôt que de ne rien montrer', async () => {
    vi.spyOn(api, 'catalogue').mockResolvedValue([]);

    monterPage(<CataloguePage />);

    expect(await screen.findByText(/Aucun service disponible/)).toBeInTheDocument();
  });
});
