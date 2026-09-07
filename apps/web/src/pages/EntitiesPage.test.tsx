import type { EntitySummary } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, sessionFactice, tousDroits } from '@/test/page';
import { EntitiesPage } from './EntitiesPage';

/**
 * L'arbre des entités.
 *
 * Il porte tout le reste : les droits, la visibilité des données, les
 * référentiels. Deux règles s'y jouent, et aucune ne se lit dans le rendu.
 *
 * Le **parent ne se change pas** après coup : déplacer une entité emporterait
 * avec elle tous ses tickets et toutes ses habilitations vers une autre branche
 * de sécurité. Le champ n'est donc offert qu'à la création.
 *
 * Et la liste ne montre que le **périmètre visible** : une branche absente
 * n'est pas une donnée manquante mais une branche hors habilitation, ce que
 * l'écran doit dire plutôt que de laisser croire à une perte.
 */

const ENTITES: EntitySummary[] = [
  { id: 1, name: 'Racine', completeName: 'Racine', path: 'e1', level: 0, parentId: null },
  { id: 2, name: 'DSI', completeName: 'Racine > DSI', path: 'e1.e2', level: 1, parentId: 1 },
];

const DROITS = tousDroits(['entity']);
const SESSION = sessionFactice(DROITS);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'entities').mockResolvedValue(ENTITES);
});

describe('EntitiesPage', () => {
  it('affiche l’arbre avec le chemin complet et la profondeur', async () => {
    monterPage(<EntitiesPage session={SESSION} />, { droits: DROITS });

    expect(await screen.findByText('Racine')).toBeInTheDocument();

    // Le nom seul ne distingue pas deux « DSI » de branches differentes :
    // l'indentation dit la profondeur, et la colonne de chemin porte
    // l'identifiant materialise sur lequel la securite s'appuie.
    expect(screen.getByText('DSI')).toBeInTheDocument();
    expect(screen.getByText('e1.e2')).toBeInTheDocument();
  });

  it('n’offre le parent qu’à la création', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<EntitiesPage session={SESSION} />, { droits: DROITS });
    await screen.findByText('Racine');

    await utilisateur.click(screen.getByRole('button', { name: /Nouvelle entité/ }));

    expect(await screen.findByLabelText('Entité parente')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }));
    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    // Deplacer une entite emporterait ses tickets et ses habilitations vers une
    // autre branche de securite : le champ n'existe pas a la modification.
    await screen.findByLabelText('Nom');
    expect(screen.queryByLabelText('Entité parente')).not.toBeInTheDocument();
  });

  it('crée une entité sous le parent choisi', async () => {
    const utilisateur = userEvent.setup();
    const creer = vi.spyOn(api, 'createEntity').mockResolvedValue(ENTITES[1]!);

    monterPage(<EntitiesPage session={SESSION} />, { droits: DROITS });
    await screen.findByText('Racine');

    await utilisateur.click(screen.getByRole('button', { name: /Nouvelle entité/ }));
    await utilisateur.type(await screen.findByLabelText('Nom'), 'Filiale Sud');
    await utilisateur.selectOptions(screen.getByLabelText('Entité parente'), '1');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(creer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Filiale Sud', parentId: 1 }),
      );
    });
  });

  it('renomme sans toucher au parent', async () => {
    const utilisateur = userEvent.setup();
    const modifier = vi.spyOn(api, 'updateEntity').mockResolvedValue(ENTITES[0]!);

    monterPage(<EntitiesPage session={SESSION} />, { droits: DROITS });
    await screen.findByText('Racine');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    const nom = await screen.findByLabelText('Nom');

    await utilisateur.clear(nom);
    await utilisateur.type(nom, 'Siège');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(modifier).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Siège' }));
    });

    expect(modifier.mock.calls[0]![1]).not.toHaveProperty('parentId');
  });

  it('dit que la liste est bornée au périmètre plutôt que de la laisser muette', async () => {
    vi.spyOn(api, 'entities').mockRejectedValue(new ApiError(403, 'Interdit'));

    monterPage(<EntitiesPage session={SESSION} />, { droits: DROITS });

    expect(await screen.findByText(/ne permet pas/i)).toBeInTheDocument();
  });

  it('cache création, modification et suppression selon les droits', async () => {
    const lecture = sessionFactice({ 'entity:read': 'all' });

    monterPage(<EntitiesPage session={lecture} />, { droits: { 'entity:read': 'all' } });

    await screen.findByText('Racine');

    expect(screen.queryByRole('button', { name: /Nouvelle entité/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'createEntity').mockRejectedValue(new ApiError(409, 'Nom deja pris.'));

    monterPage(<EntitiesPage session={SESSION} />, { droits: DROITS });
    await screen.findByText('Racine');

    await utilisateur.click(screen.getByRole('button', { name: /Nouvelle entité/ }));
    await utilisateur.type(await screen.findByLabelText('Nom'), 'DSI');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Nom deja pris.')).toBeInTheDocument();
  });
});
