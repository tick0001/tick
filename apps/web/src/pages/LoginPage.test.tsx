import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { rendre } from '@/test/rendu';
import { LoginPage } from './LoginPage';

/**
 * `spyOn` plutot qu'un mock de module : seule `instance` est remplacee, et le
 * reste du client — dont `ApiError`, dont depend la gestion d'echec de la
 * connexion — reste le vrai.
 */
function bandeau(valeur: string | null) {
  return vi.spyOn(api, 'instance').mockResolvedValue({ banner: valeur });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginPage', () => {
  it("affiche le message d'accueil de l'exploitant", async () => {
    bandeau('Support N1 : 01 23 45 67 89');

    rendre(<LoginPage />);

    expect(await screen.findByText('Support N1 : 01 23 45 67 89')).toBeInTheDocument();
  });

  it("n'affiche rien quand aucun message n'est configure", async () => {
    const appel = bandeau(null);

    rendre(<LoginPage />);

    await waitFor(() => expect(appel).toHaveBeenCalled());
    expect(screen.queryByText(/Support N1/)).not.toBeInTheDocument();
  });

  it('reste utilisable si la route publique echoue', async () => {
    // Le moment ou l'API ne repond pas est precisement celui ou l'ecran de
    // connexion doit rester affiche : le bandeau est un confort, pas une
    // condition.
    vi.spyOn(api, 'instance').mockRejectedValue(new Error('injoignable'));

    rendre(<LoginPage />);

    expect(await screen.findByRole('button', { name: /connecter|sign in/i })).toBeEnabled();
  });

  it('conserve les retours a la ligne du message', async () => {
    // Un exploitant qui ecrit une liste doit obtenir une liste : sans
    // `whitespace-pre-line`, le HTML replie tout en un paragraphe compact.
    bandeau('Maintenance dimanche\nSupport ferme');

    rendre(<LoginPage />);

    const message = await screen.findByText(/Maintenance dimanche/);
    expect(message).toHaveTextContent('Maintenance dimanche Support ferme');
    expect(message.className).toContain('whitespace-pre-line');
  });

  it('fait des adresses des liens cliquables', async () => {
    bandeau('Les comptes : https://tickand.fr/#comptes');

    rendre(<LoginPage />);

    const lien = await screen.findByRole('link', { name: 'https://tickand.fr/#comptes' });
    expect(lien).toHaveAttribute('href', 'https://tickand.fr/#comptes');
    expect(lien).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('laisse la ponctuation finale hors du lien', async () => {
    // Sans cela, « voir https://exemple.fr. » produit un lien vers une adresse
    // qui se termine par un point, et qui ne mene nulle part.
    bandeau('Voir https://exemple.fr/aide.');

    rendre(<LoginPage />);

    const lien = await screen.findByRole('link');
    expect(lien).toHaveAttribute('href', 'https://exemple.fr/aide');
  });

  it('ne promeut pas un javascript: en lien', async () => {
    bandeau('javascript:alert(1)');

    rendre(<LoginPage />);

    await screen.findByText('javascript:alert(1)');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('rend le message comme du texte, jamais comme du balisage', async () => {
    bandeau('<img src=x onerror="alert(1)">');

    rendre(<LoginPage />);

    const message = await screen.findByText('<img src=x onerror="alert(1)">');
    expect(message.querySelector('img')).toBeNull();
  });
});
