import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as icones from './icons';
import type { Icone } from './icons';

/**
 * Propriétés vraies de **toutes** les icônes, vérifiées d'un coup.
 *
 * Un test par icône les ferait diverger : celle qu'on ajoute demain n'aurait
 * pas le sien. Ce fichier part donc des exports, si bien qu'une icône nouvelle
 * est soumise aux mêmes règles sans que personne y pense.
 *
 * Ce qui est vérifié tient à ce qui fait qu'un jeu d'icônes tient ensemble :
 * une grille commune, un trait commun, et le fait qu'aucune n'est annoncée aux
 * lecteurs d'écran — elles doublent toujours un texte, et les entendre deux
 * fois n'aide personne.
 */

/**
 * Les exports sont élargis avant d'être filtrés.
 *
 * `Object.entries` produit l'union de tous les types exportés, et un prédicat
 * de type doit être assignable à ce qu'il filtre — ce qu'une union de cette
 * taille n'admet pas. Passer par `unknown` rend le filtre écrivable sans rien
 * affaiblir : ce qui en sort est vérifié à l'exécution, juste en dessous.
 */
const exportes = icones as Record<string, unknown>;

const toutes = Object.entries(exportes)
  .filter(
    (entree): entree is [string, Icone] =>
      entree[0].startsWith('Icon') && typeof entree[1] === 'function',
  )
  .sort(([a], [b]) => a.localeCompare(b));

describe('Icônes', () => {
  it('en expose au moins vingt', () => {
    // Garde-fou : si le module cessait d'exporter, ce fichier passerait en ne
    // verifiant plus rien.
    expect(toutes.length).toBeGreaterThan(20);
  });

  it.each(toutes)('%s dessine sur la grille de 24', (_nom, Icone_) => {
    const { container } = render(<Icone_ />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it.each(toutes)('%s garde le trait du jeu', (_nom, Icone_) => {
    const { container } = render(<Icone_ />);
    const svg = container.querySelector('svg');

    // Un trait ou des extremites differentes se voient immediatement dans une
    // barre de navigation, bien plus qu'un trace approximatif.
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
    expect(svg).toHaveAttribute('stroke-linecap', 'round');
    expect(svg).toHaveAttribute('fill', 'none');
  });

  it.each(toutes)('%s reste muette pour les lecteurs d’écran', (_nom, Icone_) => {
    const { container } = render(<Icone_ />);

    // Elles doublent toujours un texte : les annoncer ferait entendre deux fois
    // la meme chose a qui navigue au clavier.
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden');
  });

  it.each(toutes)('%s accepte une classe et une taille', (_nom, Icone_) => {
    const { container } = render(<Icone_ className="size-5 text-brand" />);

    expect(container.querySelector('svg')).toHaveClass('size-5', 'text-brand');
  });

  it.each(toutes)('%s trace au moins une forme', (_nom, Icone_) => {
    const { container } = render(<Icone_ />);

    // Une icone vide passe inapercue a la relecture et laisse un trou dans le
    // menu : elle occupe sa place sans rien montrer.
    expect(container.querySelectorAll('path, circle, rect, line, polyline').length).toBeGreaterThan(
      0,
    );
  });
});
