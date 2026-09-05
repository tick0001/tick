import { definePluginClient } from '@tick/plugin-sdk/client';

/**
 * Partie interface du plugin de référence.
 *
 * Aucun import de React : le contrat d'affichage est un `render` sur un élément
 * du DOM. Le bundle est donc un module ESM autonome, chargé par un `import()`
 * ordinaire, sans dépendance partagée avec l'hôte ni carte d'import.
 */
export default definePluginClient({
  register(api) {
    api.slots.add('app.header', {
      id: 'salutation',
      order: 10,
      render(element, context) {
        const badge = document.createElement('span');

        badge.textContent = `Bonjour — ${context.entity.name}`;
        badge.className =
          'rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 ' +
          'dark:bg-emerald-900 dark:text-emerald-200';
        element.append(badge);

        // Rien à nettoyer ici : l'hôte vide l'élément au démontage. La fonction
        // de nettoyage sert aux ressources que le DOM ne libère pas seul.
        return () => {
          badge.remove();
        };
      },
    });

    api.slots.add('entity.list.actions', {
      id: 'compteur',
      render(element, context) {
        const bouton = document.createElement('button');

        bouton.type = 'button';
        bouton.textContent = 'Plugin : compter';
        bouton.className =
          'rounded-md border border-neutral-300 px-2.5 py-1 text-xs ' +
          'hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';

        bouton.addEventListener('click', () => {
          const lignes = document.querySelectorAll('tbody tr').length;

          bouton.textContent = `${String(lignes)} entité(s) — ${context.profile.name}`;
        });

        element.append(bouton);
      },
    });
  },
});
