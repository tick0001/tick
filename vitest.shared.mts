import type { ViteUserConfig } from 'vitest/config';

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
export const couverture: NonNullable<NonNullable<ViteUserConfig['test']>['coverage']> = {
  provider: 'v8',
  reporter: ['text-summary', 'json-summary', 'html'],
  reportsDirectory: './coverage',
  // `all` compte aussi les fichiers qu'aucun test n'importe. Sans lui, un
  // module entierement non teste disparait du rapport, et le pourcentage monte
  // a mesure qu'on teste moins de choses.
  all: true,
  include: ['src/**/*.{ts,tsx}'],
  exclude: [
    // Les tests eux-memes.
    'src/**/*.{test,spec}.{ts,tsx}',
    'src/test/**',

    // Declarations de types : aucune instruction a executer.
    'src/**/*.d.ts',
  ],
};
