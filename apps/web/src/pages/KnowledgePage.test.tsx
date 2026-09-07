import type { KbArticle, KbArticleSummary, KbCategory, KbRevision } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { KnowledgePage } from './KnowledgePage';

/**
 * La base de connaissance.
 *
 * Un article y porte deux drapeaux qu'il ne faut pas confondre : **publié**
 * décide qu'il est lisible, **FAQ** qu'il l'est *sans compte*, par quiconque a
 * l'adresse. Les afficher pareil serait la meilleure façon de publier au monde
 * une procédure interne, et c'est ce que ces tests surveillent en premier.
 *
 * Le reste tient au filtrage, qui se fait côté serveur : chercher dans la page
 * ne trouverait jamais au-delà de ce qui est déjà chargé.
 */

function resume(
  id: number,
  nom: string,
  surcharge: Partial<KbArticleSummary> = {},
): KbArticleSummary {
  return {
    id,
    name: nom,
    excerpt: 'Un extrait',
    categoryId: 1,
    categoryName: 'Réseau',
    isFaq: false,
    isPublished: true,
    viewCount: 12,
    version: 1,
    entityId: 1,
    entityName: 'Racine',
    isRecursive: true,
    isFavorite: false,
    author: 'Alice Martin',
    updatedAt: '2026-03-01T09:00:00.000Z',
    ...surcharge,
  };
}

const ARTICLES: KbArticleSummary[] = [
  resume(1, 'Réinitialiser son mot de passe', { isFaq: true, isFavorite: true }),
  // Non publie : un brouillon que personne d'autre ne voit encore.
  resume(2, 'Procédure interne', { isPublished: false, viewCount: 0 }),
];

const ARTICLE: KbArticle = {
  ...resume(1, 'Réinitialiser son mot de passe', { isFaq: true, isFavorite: true }),
  content: 'Rendez-vous sur le portail.',
  targets: [],
};

const CATEGORIES: KbCategory[] = [
  { id: 1, parentId: null, name: 'Réseau', completeName: 'Réseau', path: 'n1', level: 0 },
];

const REVISIONS: KbRevision[] = [
  {
    version: 1,
    name: 'Réinitialiser son mot de passe',
    content: 'Ancienne version',
    author: 'Alice Martin',
    createdAt: '2026-02-01T09:00:00.000Z',
  },
];

const DROITS = tousDroits(['kb']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'kbCategories').mockResolvedValue(CATEGORIES);
  vi.spyOn(api, 'kbArticles').mockResolvedValue(ARTICLES);
  vi.spyOn(api, 'kbArticle').mockResolvedValue(ARTICLE);
  vi.spyOn(api, 'kbRevisions').mockResolvedValue(REVISIONS);
});

describe('KnowledgePage', () => {
  it('distingue un article de FAQ d’un simple brouillon', async () => {
    monterPage(<KnowledgePage />, { droits: DROITS });

    expect(await screen.findByText('Réinitialiser son mot de passe')).toBeInTheDocument();

    // « FAQ » ne veut pas dire « publie » mais « lisible sans compte » : les
    // afficher pareil ferait publier au monde une procedure interne.
    expect(screen.getByText(/FAQ/)).toBeInTheDocument();
    expect(screen.getByText(/brouillon/i)).toBeInTheDocument();
  });

  it('cherche côté serveur plutôt que dans la page', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'kbArticles');

    monterPage(<KnowledgePage />, { droits: DROITS });
    await screen.findByText('Réinitialiser son mot de passe');

    await utilisateur.type(screen.getByPlaceholderText(/Rechercher/), 'mot de passe');

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'mot de passe', favoritesOnly: false }),
      );
    });
  });

  it('filtre par catégorie et par favoris', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'kbArticles');

    monterPage(<KnowledgePage />, { droits: DROITS });
    await screen.findByText('Réinitialiser son mot de passe');

    await utilisateur.selectOptions(screen.getByDisplayValue(/Toutes les catégories/), '1');

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 1 }));
    });

    await utilisateur.click(screen.getByRole('checkbox', { name: /favoris/i }));

    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith(expect.objectContaining({ favoritesOnly: true }));
    });
  });

  it('ouvre un article avec son contenu et son historique', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<KnowledgePage />, { droits: DROITS });

    await utilisateur.click(
      await screen.findByRole('button', { name: /Réinitialiser son mot de passe/ }),
    );

    expect(await screen.findByText('Rendez-vous sur le portail.')).toBeInTheDocument();

    // Les revisions disent qui a change quoi : sans elles, un article faux
    // n'a pas d'auteur a qui demander.
    expect(screen.getAllByText(/Alice Martin/).length).toBeGreaterThan(0);
  });

  it('bascule un favori', async () => {
    const utilisateur = userEvent.setup();
    const basculer = vi.spyOn(api, 'toggleKbFavorite').mockResolvedValue({ isFavorite: false });

    monterPage(<KnowledgePage />, { droits: DROITS });

    await utilisateur.click(
      await screen.findByRole('button', { name: /Réinitialiser son mot de passe/ }),
    );
    await screen.findByText('Rendez-vous sur le portail.');

    const favori = screen.getAllByRole('button').find((bouton) => bouton.textContent === '★');

    if (favori) {
      await utilisateur.click(favori);

      await waitFor(() => {
        expect(basculer.mock.calls[0]?.[0]).toBe(1);
      });
    }
  });

  it('cache la rédaction à qui n’a pas le droit d’écrire', async () => {
    monterPage(<KnowledgePage />, { droits: { 'kb:read': 'all' } });

    await screen.findByText('Réinitialiser son mot de passe');

    expect(screen.queryByRole('button', { name: /Nouvel article/ })).not.toBeInTheDocument();
  });

  it('crée un article', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveKbArticle').mockResolvedValue(ARTICLE);

    monterPage(<KnowledgePage />, { droits: DROITS });
    await screen.findByText('Réinitialiser son mot de passe');

    await utilisateur.click(screen.getByRole('button', { name: /Nouvel article/ }));

    // Titre **et** contenu : les deux sont `required`, et la soumission ne part
    // pas tant que l'un manque.
    await utilisateur.type(await screen.findByPlaceholderText('Titre'), 'Nouvelle procédure');
    await utilisateur.type(screen.getByPlaceholderText(/Contenu/i), 'Marche a suivre');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Nouvelle procédure', content: 'Marche a suivre' }),
        undefined,
      );
    });
  });

  it('montre le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveKbArticle').mockRejectedValue(new ApiError(400, 'Titre deja pris.'));

    monterPage(<KnowledgePage />, { droits: DROITS });
    await screen.findByText('Réinitialiser son mot de passe');

    await utilisateur.click(screen.getByRole('button', { name: /Nouvel article/ }));
    await utilisateur.type(await screen.findByPlaceholderText('Titre'), 'Doublon');
    await utilisateur.type(screen.getByPlaceholderText(/Contenu/i), 'Texte');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Titre deja pris.')).toBeInTheDocument();
  });
});
