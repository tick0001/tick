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

  it('rend le message comme du texte, jamais comme du balisage', async () => {
    bandeau('<img src=x onerror="alert(1)">');

    rendre(<LoginPage />);

    const message = await screen.findByText('<img src=x onerror="alert(1)">');
    expect(message.querySelector('img')).toBeNull();
  });
});
