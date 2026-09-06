import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import {
  IconAnnuaire,
  IconCourriel,
  IconDroits,
  IconEngagement,
  IconEnquete,
  IconEntites,
  IconFormulaire,
  IconGroupes,
  IconNotification,
  IconReglages,
  IconRegles,
  IconUtilisateurs,
  type Icone,
} from '@/components/ui/icons';
import { cn } from '@/lib/utils';

interface Entree {
  to: string;
  label: string;
  icone: Icone;
}

/**
 * Zone de configuration.
 *
 * Douze écrans qu'on règle une fois par trimestre : les laisser dans la barre
 * latérale principale lui faisait dépasser la hauteur de l'écran, et donnait le
 * même poids visuel à « Courriel entrant » qu'à « Tickets ». Ils vivent donc
 * dans leur propre zone, avec leur propre navigation.
 *
 * Le sous-menu est une colonne et non des onglets : douze onglets ne tiennent
 * pas sur une ligne, et les replier dans un menu déroulant coûterait un clic à
 * chaque va-et-vient entre deux écrans de réglage — ce qui est exactement ce
 * qu'on fait quand on configure.
 */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  const groupes: { titre: string; entrees: Entree[] }[] = [
    {
      titre: t('configuration.groupes.assistance'),
      entrees: [
        { to: '/settings/service-levels', label: t('engagements.titre'), icone: IconEngagement },
        { to: '/settings/rules', label: t('regles.titre'), icone: IconRegles },
        { to: '/settings/forms', label: t('formulaires.titre'), icone: IconFormulaire },
      ],
    },
    {
      titre: t('configuration.groupes.communication'),
      entrees: [
        { to: '/settings/notifications', label: t('notifications.titre'), icone: IconNotification },
        { to: '/settings/mail', label: t('courriel.titre'), icone: IconCourriel },
        { to: '/settings/surveys', label: t('enquetes.titre'), icone: IconEnquete },
      ],
    },
    {
      titre: t('configuration.groupes.organisation'),
      entrees: [
        { to: '/settings/entities', label: t('navigation.entites'), icone: IconEntites },
        {
          to: '/settings/users',
          label: t('administration.utilisateurs.titre'),
          icone: IconUtilisateurs,
        },
        { to: '/settings/groups', label: t('administration.groupes.titre'), icone: IconGroupes },
        { to: '/settings/profiles', label: t('administration.profils.titre'), icone: IconDroits },
      ],
    },
    {
      titre: t('configuration.groupes.systeme'),
      entrees: [
        {
          to: '/settings/directories',
          label: t('administration.annuaires.titre'),
          icone: IconAnnuaire,
        },
        {
          to: '/settings/general',
          label: t('administration.reglages.titre'),
          icone: IconReglages,
        },
      ],
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{t('configuration.titre')}</h2>
          <p className="text-xs text-muted">{t('configuration.description')}</p>
        </div>

        {groupes.map((groupe) => (
          <div key={groupe.titre} className="space-y-1">
            <p className="px-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
              {groupe.titre}
            </p>

            {groupe.entrees.map((entree) => {
              const Icone = entree.icone;

              return (
                <NavLink
                  key={entree.to}
                  to={entree.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-brand-soft font-medium text-brand-ink'
                        : 'text-muted hover:bg-sunken hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icone
                        className={cn('size-4 shrink-0', isActive ? 'text-brand' : 'text-faint')}
                      />
                      <span className="truncate">{entree.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
