import type { PluginClientDefinition, SlotEntry, SlotName } from '@tick/plugin-sdk/client';

export interface LoadedSlotEntry extends SlotEntry {
  pluginId: string;
}

const slots = new Map<SlotName, LoadedSlotEntry[]>();

/**
 * Instance unique pour l'absence d'entree.
 *
 * `useSyncExternalStore` compare les instantanes par identite : renvoyer un
 * tableau vide neuf a chaque lecture provoquerait un rendu en boucle.
 */
const AUCUNE: readonly LoadedSlotEntry[] = Object.freeze([]);
const charges = new Set<string>();
const abonnes = new Set<() => void>();

function notifier(): void {
  for (const abonne of abonnes) abonne();
}

export function subscribeToSlots(listener: () => void): () => void {
  abonnes.add(listener);

  return () => {
    abonnes.delete(listener);
  };
}

export function entriesFor(slot: SlotName): readonly LoadedSlotEntry[] {
  return slots.get(slot) ?? AUCUNE;
}

interface PluginStatus {
  id: string;
  state: string;
  hasClient: boolean;
}

/**
 * Charge les bundles d'interface des plugins actifs.
 *
 * Chaque bundle est un module ESM autonome, récupéré par un `import()`
 * ordinaire : aucune carte d'import, aucune variable globale partagée, aucune
 * instance de React commune. C'est ce que permet le choix d'un contrat
 * d'affichage fondé sur un `render` sur un élément du DOM plutôt que sur des
 * composants React.
 *
 * L'échec d'un plugin est isolé : il est journalisé, et les autres se chargent.
 * Une extension cassée ne doit pas emporter l'application.
 */
export async function loadPluginClients(): Promise<void> {
  const reponse = await fetch('/api/plugins', { credentials: 'include' });

  // Sans le droit `plugin:read`, l'utilisateur ne peut pas lister les plugins.
  // Ce n'est pas une erreur : il n'y a simplement rien à charger.
  if (!reponse.ok) return;

  const statuts = (await reponse.json()) as PluginStatus[];

  await Promise.all(
    statuts
      .filter((statut) => statut.state === 'actif' && statut.hasClient)
      .filter((statut) => !charges.has(statut.id))
      .map(async (statut) => {
        try {
          const module = (await import(
            /* @vite-ignore */ `/api/plugins/${statut.id}/client.js`
          )) as { default?: PluginClientDefinition };

          module.default?.register({
            slots: {
              add: (slot, entry) => {
                // Nouveau tableau plutot qu'une mutation : l'instantane doit
                // changer d'identite pour que l'interface se redessine.
                const liste = [...(slots.get(slot) ?? []), { ...entry, pluginId: statut.id }];

                liste.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
                slots.set(slot, liste);
              },
            },
          });

          charges.add(statut.id);
        } catch (error) {
          console.error(`Plugin « ${statut.id} » : chargement impossible.`, error);
        }
      }),
  );

  notifier();
}

/** Oublie tout ce qui a été chargé. Utilisé à la déconnexion. */
export function resetPluginClients(): void {
  slots.clear();
  charges.clear();
  notifier();
}
