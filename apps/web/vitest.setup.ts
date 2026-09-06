import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Demontage entre deux tests.
 *
 * Sans lui, les arbres rendus s'accumulent dans le meme document : une requete
 * `getByText` trouverait alors deux occurrences et echouerait, pour une raison
 * qui n'a rien a voir avec ce que le test verifie.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * `matchMedia` n'existe pas dans happy-dom.
 *
 * Le theme l'interroge au montage. Le simuler ici plutot que dans chaque test
 * evite d'avoir a s'en souvenir a chaque nouveau composant.
 */
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
