import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTheme } from './theme';

/**
 * Le thème est une préférence de **poste**, pas de compte.
 *
 * La même personne peut vouloir le mode sombre sur son portable et le mode
 * clair sur le poste fixe de l'atelier. Il vit donc dans le stockage local, et
 * « système » retire l'attribut au lieu d'en poser un troisième : la feuille de
 * style bascule alors sur `prefers-color-scheme` toute seule.
 */
describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('démarre sur « système » quand rien n’est mémorisé', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('relit le choix mémorisé', () => {
    localStorage.setItem('tick.theme', 'dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignore une valeur mémorisée illisible', () => {
    // Une cle du stockage local peut avoir ete ecrite par une version
    // precedente, ou a la main : elle ne doit pas figer l'interface.
    localStorage.setItem('tick.theme', 'fuchsia');

    expect(renderHook(() => useTheme()).result.current.theme).toBe('system');
  });

  it('applique le thème choisi au document', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('tick.theme')).toBe('light');
  });

  it('efface la mémoire en revenant à « système »', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });
    act(() => {
      result.current.setTheme('system');
    });

    // Retirer l'attribut, et non en poser un troisieme : sans cela le document
    // resterait fige sur le dernier choix, sourd au reglage du poste.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('tick.theme')).toBeNull();
  });

  it('suit le changement fait dans un autre onglet', () => {
    const { result } = renderHook(() => useTheme());

    localStorage.setItem('tick.theme', 'dark');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'tick.theme', newValue: 'dark' }));
    });

    // Deux fenetres du meme outil qui ne se ressemblent plus donnent
    // l'impression d'avoir ouvert deux applications differentes.
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignore un changement portant sur une autre clé', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'tick.locale', newValue: 'en' }));
    });

    expect(result.current.theme).toBe('system');
  });

  it('cesse d’écouter une fois démonté', () => {
    const { unmount } = renderHook(() => useTheme());

    unmount();
    localStorage.setItem('tick.theme', 'dark');

    // Sans le retrait de l'ecouteur, chaque navigation laisserait derriere elle
    // un abonnement qui met a jour un composant disparu.
    expect(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'tick.theme', newValue: 'dark' }));
    }).not.toThrow();
  });
});
