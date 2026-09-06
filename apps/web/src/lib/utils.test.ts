import { describe, expect, it } from 'vitest';
import { cn } from './utils';

/**
 * `cn` fusionne des classes Tailwind en tranchant les conflits.
 *
 * Sans elle, `class="p-2 p-4"` laisse le navigateur choisir selon l'ordre de la
 * feuille de style, et non selon l'ordre d'écriture : une variante passée en
 * propriété serait ignorée une fois sur deux, sans erreur ni motif apparent.
 */
describe('cn', () => {
  it('assemble des classes', () => {
    expect(cn('rounded', 'border')).toBe('rounded border');
  });

  it('laisse la dernière classe l’emporter sur un conflit', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
  });

  it('ne confond pas deux propriétés voisines', () => {
    // `px` et `py` ne sont pas en conflit : les fondre laisserait un composant
    // sans marge verticale des qu'on lui passe une marge horizontale.
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4');
  });

  it('ignore les valeurs conditionnelles éteintes', () => {
    expect(cn('base', false, null, undefined, '')).toBe('base');
    expect(cn('base', { actif: false, visible: true })).toBe('base visible');
  });

  it('aplatit les tableaux imbriqués', () => {
    expect(cn(['a', ['b', 'c']])).toBe('a b c');
  });

  it('rend une chaîne vide sans argument', () => {
    expect(cn()).toBe('');
  });
});
