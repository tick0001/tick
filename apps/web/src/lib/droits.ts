import type { RightScope, SessionContext } from '@tick/contracts';

/**
 * Lecture des droits du profil actif.
 *
 * La session porte les droits sous la forme `objet:action` → portée. Composer
 * cette clé à la main dans chaque écran finit par produire des fautes de frappe
 * silencieuses : `'mailcollectors:read'` n'existe pas, l'appel rend `false`, et
 * l'entrée disparaît du menu sans que personne comprenne pourquoi. Le passage
 * par une fonction rend la clé unique et vérifiable.
 *
 * **Ce n'est pas un contrôle d'accès.** Le serveur refuse déjà ce qui n'est pas
 * permis, et c'est lui qui fait autorité : masquer un bouton n'empêche personne
 * d'appeler la route. Ce qui se joue ici est la lisibilité — ne pas proposer ce
 * qui sera refusé, pour que l'interface ne mente pas sur ce qu'elle permet.
 */

/** Un droit, tel que le catalogue le nomme. */
export interface Droit {
  objet: string;
  action: 'read' | 'create' | 'update' | 'delete';
}

export function porteeDe(session: SessionContext, droit: Droit): RightScope | undefined {
  return session.rights[`${droit.objet}:${droit.action}`];
}

/**
 * Vrai si le profil actif détient le droit, quelle qu'en soit la portée.
 *
 * L'absence de ligne vaut refus — c'est la règle du modèle, et elle vaut ici
 * comme en base. La portée (`own`, `group`, `entity`…) dit *quelles lignes* sont
 * concernées, jamais *si* l'écran s'ouvre : un technicien qui ne voit que ses
 * propres tickets garde une entrée « Tickets » qui a du sens.
 */
export function peut(session: SessionContext, objet: string, action: Droit['action']): boolean {
  return porteeDe(session, { objet, action }) !== undefined;
}
