import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useRetourAccueilALaDeconnexion } from './session-navigation';

/**
 * Ce que devient l'adresse quand la session tombe.
 *
 * Deux situations se ressemblent à l'écran et n'ont rien à voir :
 *
 *  - **j'ai été déconnecté** — l'adresse affichée est celle d'un écran auquel
 *    j'avais droit il y a une minute. Se reconnecter la rejoue, et rien ne dit
 *    que le profil retrouvé y a encore droit : on rouvre `/settings/users` sur
 *    un compte de technicien, qui voit un refus sans le rapprocher de sa
 *    reconnexion ;
 *  - **je n'étais pas connecté** — l'adresse vient d'un lien reçu par courriel,
 *    et c'est précisément là que l'on veut arriver après la connexion.
 *
 * D'où un déclenchement sur la transition, et non sur l'état.
 */

function Sonde({ connecte }: { connecte: boolean }) {
  useRetourAccueilALaDeconnexion(connecte);

  const emplacement = useLocation();

  return <span data-testid="adresse">{emplacement.pathname}</span>;
}

function monter(connecte: boolean, depart: string): ReturnType<typeof render> {
  return render(<Sonde connecte={connecte} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[depart]}>
        <Routes>
          <Route path="*" element={children} />
        </Routes>
      </MemoryRouter>
    ),
  });
}

function adresse(): string {
  return screen.getByTestId('adresse').textContent ?? '';
}

describe('useRetourAccueilALaDeconnexion', () => {
  it('ramène à la racine en perdant la session', () => {
    const { rerender } = monter(true, '/settings/users');

    expect(adresse()).toBe('/settings/users');

    rerender(<Sonde connecte={false} />);

    expect(adresse()).toBe('/');
  });

  it('ne touche à rien tant que la session tient', () => {
    const { rerender } = monter(true, '/tickets/12');

    rerender(<Sonde connecte />);

    // Remettre l'adresse a zero a chaque rendu empecherait toute navigation.
    expect(adresse()).toBe('/tickets/12');
  });

  it('laisse un lien profond ouvert sans session', () => {
    monter(false, '/tickets/12');

    // On n'a pas ete deconnecte : on n'etait pas connecte. Le ticket vient sans
    // doute d'un courriel, et il doit s'ouvrir apres la connexion.
    expect(adresse()).toBe('/tickets/12');
  });

  it('ne rejoue pas la remise à zéro sur les rendus suivants', () => {
    const { rerender } = monter(true, '/settings/users');

    rerender(<Sonde connecte={false} />);
    expect(adresse()).toBe('/');

    // Une navigation pendant que l'ecran de connexion est affiche doit tenir :
    // c'est ce qui permettra, plus tard, un lien « mot de passe oublie ».
    rerender(<Sonde connecte={false} />);
    expect(adresse()).toBe('/');
  });

  it('se réarme après une reconnexion', () => {
    const { rerender } = monter(true, '/settings/users');

    rerender(<Sonde connecte={false} />);
    expect(adresse()).toBe('/');

    rerender(<Sonde connecte />);
    rerender(<Sonde connecte={false} />);

    // La regle vaut a chaque deconnexion, pas seulement a la premiere.
    expect(adresse()).toBe('/');
  });

  it('vise la racine, et non un écran nommé', () => {
    const { rerender } = monter(true, '/stats');

    rerender(<Sonde connecte={false} />);

    // La route d'accueil depend de l'interface du profil — complete ou
    // simplifiee. Figer `/tickets` ici enverrait un demandeur sur un ecran
    // qu'il n'a pas le droit d'ouvrir, ce que ce crochet cherche a eviter.
    expect(adresse()).toBe('/');
  });
});
