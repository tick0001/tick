/**
 * Contrats partages entre l'API, l'interface et les plugins.
 *
 * Tout ce qui traverse une frontiere de processus est decrit ici une seule fois,
 * sous forme de schema Zod, dont les types TypeScript sont deduits. Un schema
 * est a la fois la documentation, la validation a l'execution et le type
 * statique : les trois ne peuvent pas diverger.
 */
export * from './modules/common.js';
export * from './modules/entities.js';
export * from './modules/auth.js';
export * from './modules/itil.js';
export * from './modules/search.js';
export * from './modules/slm.js';
