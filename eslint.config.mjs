import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.turbo/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Les scripts de la racine tournent sous Node, hors de tout paquet : ils
    // echappent au `pnpm lint`, qui ne parcourt que les `src`. Les deux globales
    // declarees ici plutot que le paquet `globals` en entier — ce sont les
    // seules qu'un script d'outillage utilise.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // Le corps d'une reponse HTTP est `any` : supertest le type ainsi parce
    // qu'il l'est reellement — c'est du JSON qui vient du reseau. Dans ces
    // tests, ce sont les assertions qui tiennent lieu de typage, et exiger une
    // conversion a chaque acces les noierait sans rien verifier de plus.
    files: ['**/*.http.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
