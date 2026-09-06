import type { CoverageOptions } from 'vitest/node';

/**
 * Reglages de couverture partages par tous les paquets.
 *
 * Un seul endroit ou decider ce qui compte : sans cela, chaque paquet aurait
 * sa propre liste d'exclusions, et « 100 % » ne voudrait pas dire la meme chose
 * d'un paquet a l'autre.
 *
 * Le fournisseur est V8 : il instrumente a l'execution plutot qu'a la
 * compilation, ce qui evite d'ajouter une transformation supplementaire au
 * chemin de build et donne des chiffres qui correspondent au code reellement
 * execute.
 */
export const couverture: CoverageOptions = {
  provider: 'v8',
  reporter: ['text-summary', 'json-summary', 'html'],
  reportsDirectory: './coverage',
  // `include` decide de ce qui compte. Vitest 5 rapporte d'office les fichiers
  // qu'aucun test n'importe -- l'option `all` d'autrefois n'existe plus, et son
  // comportement est devenu la regle. Sans cette liste, un module entierement
  // non teste disparaitrait du rapport, et le pourcentage monterait a mesure
  // qu'on teste moins de choses.
  include: ['src/**/*.{ts,tsx}'],
  exclude: [
    // Les tests eux-memes.
    'src/**/*.{test,spec}.{ts,tsx}',
    'src/test/**',

    // Declarations de types : aucune instruction a executer.
    'src/**/*.d.ts',
  ],
};
