/**
 * Surface interface offerte aux plugins.
 *
 * **Décision structurante : le contrat d'affichage est un `render` sur un
 * élément du DOM, pas un composant React.**
 *
 * Rendre des composants React exigerait que le plugin et l'hôte partagent la
 * même instance de React — ce qui impose une carte d'import ou des variables
 * globales, se règle différemment en développement et en production, et casse
 * silencieusement dès qu'une version diverge. Un `render` sur un élément
 * supprime le problème entièrement : le bundle du plugin est un module ESM
 * ordinaire, chargé par un `import()` ordinaire, sans dépendance partagée.
 *
 * Le coût est réel — un plugin qui veut React doit l'embarquer — et sera
 * réévalué au jalon J3, quand on saura ce que les extensions d'interface
 * demandent vraiment.
 */

/** Emplacements que les plugins peuvent remplir. */
export type SlotName = 'app.header' | 'entity.list.actions' | 'dashboard.widgets';

export interface SlotContext {
  /** Langue active de l'interface. */
  locale: string;
  /** Entité active du contexte de travail. */
  entity: { id: number; name: string; completeName: string };
  /** Profil actif. */
  profile: { id: number; name: string };
}

/**
 * Rend le contenu du plugin dans l'élément fourni.
 *
 * Peut renvoyer une fonction de nettoyage, appelée au démontage. L'élément est
 * vidé par l'hôte de toute façon : la fonction sert aux ressources que le DOM
 * ne libère pas seul (minuteries, abonnements, écouteurs globaux).
 */
export type SlotRender = (
  element: HTMLElement,
  context: SlotContext,
) => void | (() => void) | Promise<void | (() => void)>;

export interface SlotEntry {
  id: string;
  /** Ordre d'affichage croissant. Défaut : 100. */
  order?: number;
  render: SlotRender;
}

export interface PluginClientApi {
  slots: {
    add(slot: SlotName, entry: SlotEntry): void;
  };
}

export interface PluginClientDefinition {
  register(api: PluginClientApi): void;
}

/** Déclare la partie interface d'un plugin. */
export function definePluginClient(definition: PluginClientDefinition): PluginClientDefinition {
  return definition;
}
