import type { SessionContext } from '@tick/contracts';
import { createContext, useContext, type ReactNode } from 'react';
import { peut, type Droit } from '@/lib/droits';

/**
 * La session, mise à disposition de tout l'écran.
 *
 * Elle est ambiante par nature : la barre de navigation, chaque page et les
 * emplacements de plugins ont besoin de savoir qui consulte, depuis quelle
 * entité et avec quels droits. La faire descendre de propriété en propriété
 * obligerait à modifier la signature de quinze composants pour qu'un bouton
 * sache s'il doit s'afficher — et la première page oubliée afficherait une
 * action que le serveur refuse.
 *
 * Le contexte n'a **pas** de valeur par défaut. Un `undefined` initial force à
 * traiter le cas « hors session », plutôt que de laisser un objet vide circuler
 * et rendre tous les droits absents sans qu'on sache si c'est un refus ou un
 * oubli de montage.
 */
const Contexte = createContext<SessionContext | undefined>(undefined);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionContext;
  children: ReactNode;
}) {
  return <Contexte.Provider value={session}>{children}</Contexte.Provider>;
}

export function useSession(): SessionContext {
  const session = useContext(Contexte);

  if (!session) {
    throw new Error('useSession exige un SessionProvider au-dessus.');
  }

  return session;
}

/**
 * Vrai si le profil actif détient le droit demandé.
 *
 * Sert à décider ce qui s'affiche, jamais ce qui est permis : le serveur reste
 * seul juge. Masquer un bouton évite de proposer une action qui finira en
 * refus ; cela ne protège rien par soi-même.
 */
export function usePeut(objet: string, action: Droit['action']): boolean {
  return peut(useSession(), objet, action);
}
