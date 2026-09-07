import type { SessionContext } from '@tick/contracts';
import { peut, type Droit } from '@/lib/droits';

/**
 * Droit exigé par chaque écran de configuration, dans l'ordre du menu.
 *
 * Cette table est la **seule** source : la barre latérale s'en sert pour
 * décider ce qu'elle affiche, et le routeur pour choisir où mène `/settings`.
 * Les tenir séparément les ferait diverger — le menu masquerait un écran que
 * la redirection continuerait d'ouvrir, ou l'inverse.
 *
 * Le droit est celui que la route exige côté serveur. Les deux doivent désigner
 * la même chose : sinon l'entrée reste visible et mène à un refus, ou disparaît
 * alors qu'elle fonctionnait.
 */
export const REGLAGES: readonly { to: string; droit: Droit }[] = [
  { to: '/settings/service-levels', droit: { objet: 'slm', action: 'read' } },
  { to: '/settings/rules', droit: { objet: 'rule', action: 'read' } },
  { to: '/settings/forms', droit: { objet: 'form', action: 'read' } },
  { to: '/settings/notifications', droit: { objet: 'notification', action: 'read' } },
  { to: '/settings/mail', droit: { objet: 'mailcollector', action: 'read' } },
  { to: '/settings/surveys', droit: { objet: 'satisfaction', action: 'read' } },
  { to: '/settings/entities', droit: { objet: 'entity', action: 'read' } },
  { to: '/settings/users', droit: { objet: 'user', action: 'read' } },
  { to: '/settings/groups', droit: { objet: 'group', action: 'read' } },
  { to: '/settings/profiles', droit: { objet: 'profile', action: 'read' } },
  { to: '/settings/directories', droit: { objet: 'ldap', action: 'read' } },
  { to: '/settings/general', droit: { objet: 'entity', action: 'update' } },
];

/** Droit d'un écran de configuration, par son chemin. */
export function droitDe(chemin: string): Droit | undefined {
  return REGLAGES.find((entree) => entree.to === chemin)?.droit;
}

/**
 * Premier écran de configuration que le profil actif peut ouvrir.
 *
 * `/settings` n'est pas un écran mais une zone : y entrer doit mener quelque
 * part. Viser un écran fixe conduirait un profil qui n'y a pas droit sur un
 * refus, alors même que la zone lui est ouverte pour d'autres écrans — le
 * menu montrerait alors une porte qui claque au premier pas.
 */
export function premierReglageAccessible(session: SessionContext): string | undefined {
  return REGLAGES.find((entree) => peut(session, entree.droit.objet, entree.droit.action))?.to;
}
