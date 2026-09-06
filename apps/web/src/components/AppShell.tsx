import type { SessionContext } from '@tick/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { ContextSwitcher } from '@/components/ContextSwitcher';
import { PluginSlot } from '@/components/PluginSlot';
import {
  IconCatalogue,
  IconChangement,
  IconConnaissance,
  IconCourriel,
  IconEcran,
  IconEngagement,
  IconEnquete,
  IconDroits,
  IconEntites,
  IconGroupes,
  IconFermer,
  IconFormulaire,
  IconLune,
  IconMenu,
  IconNotification,
  IconPlanning,
  IconProbleme,
  IconRecherche,
  IconRegles,
  IconSoleil,
  IconSortie,
  IconStatistiques,
  IconTicket,
  IconUtilisateurs,
  type Icone,
} from '@/components/ui/icons';
import { changeLocale } from '@/lib/i18n';
import { useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface Entree {
  to: string;
  label: string;
  icone: Icone;
}

interface Groupe {
  titre: string;
  entrees: Entree[];
}

function Lien({ entree, onNavigate }: { entree: Entree; onNavigate: () => void }) {
  const Icone = entree.icone;

  return (
    <NavLink
      to={entree.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
          isActive
            ? 'bg-brand-soft font-medium text-brand-ink'
            : 'text-muted hover:bg-sunken hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icone className={cn('size-[18px] shrink-0', isActive ? 'text-brand' : 'text-faint')} />
          <span className="truncate">{entree.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Sélecteur de thème, en trois états explicites. */
function SelecteurTheme() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const choix: { valeur: Theme; icone: Icone; libelle: string }[] = [
    { valeur: 'light', icone: IconSoleil, libelle: t('apparence.clair') },
    { valeur: 'dark', icone: IconLune, libelle: t('apparence.sombre') },
    { valeur: 'system', icone: IconEcran, libelle: t('apparence.systeme') },
  ];

  return (
    <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {choix.map(({ valeur, icone: Icone, libelle }) => (
        <button
          key={valeur}
          type="button"
          title={libelle}
          aria-label={libelle}
          aria-pressed={theme === valeur}
          onClick={() => {
            setTheme(valeur);
          }}
          className={cn(
            'rounded-[7px] p-1.5 transition-colors',
            theme === valeur ? 'bg-surface text-ink shadow-card' : 'text-faint hover:text-muted',
          )}
        >
          <Icone className="size-4" />
        </button>
      ))}
    </div>
  );
}

/**
 * Coquille de l'application.
 *
 * Barre latérale fixe sur grand écran, tiroir sur petit. Le contenu garde une
 * largeur maximale : au-delà, une ligne de tableau devient illisible parce que
 * l'œil perd la ligne entre la première et la dernière colonne.
 */
export function AppShell({
  session,
  onLogout,
  children,
}: {
  session: SessionContext;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [ouvert, setOuvert] = useState(false);

  const simplifiee = session.profile.interface === 'self_service';

  /**
   * Navigation, groupée par intention.
   *
   * Quatre groupes plutôt qu'une liste de quatorze liens : ce qu'on ouvre chaque
   * matin, ce qu'on consulte, ce qu'on analyse, ce qu'on règle une fois par
   * trimestre. Sans ce découpage, « Courriel entrant » a le même poids visuel
   * que « Tickets », et l'œil doit relire toute la liste à chaque fois.
   */
  const sections: Groupe[] = simplifiee
    ? [
        {
          titre: t('navigation.groupes.travail'),
          entrees: [
            { to: '/catalogue', label: t('catalogue.titre'), icone: IconCatalogue },
            { to: '/tickets', label: t('navigation.mesDemandes'), icone: IconTicket },
            { to: '/knowledge', label: t('connaissance.titre'), icone: IconConnaissance },
          ],
        },
      ]
    : [
        {
          titre: t('navigation.groupes.travail'),
          entrees: [
            { to: '/tickets', label: t('navigation.tickets'), icone: IconTicket },
            { to: '/itil/problems', label: t('navigation.problemes'), icone: IconProbleme },
            { to: '/itil/changes', label: t('navigation.changements'), icone: IconChangement },
            { to: '/planning', label: t('navigation.planning'), icone: IconPlanning },
          ],
        },
        {
          titre: t('navigation.groupes.services'),
          entrees: [
            { to: '/catalogue', label: t('catalogue.titre'), icone: IconCatalogue },
            { to: '/knowledge', label: t('connaissance.titre'), icone: IconConnaissance },
          ],
        },
        {
          titre: t('navigation.groupes.analyse'),
          entrees: [
            { to: '/search', label: t('recherche.titre'), icone: IconRecherche },
            { to: '/stats', label: t('navigation.statistiques'), icone: IconStatistiques },
          ],
        },
        {
          titre: t('navigation.groupes.configuration'),
          entrees: [
            { to: '/service-levels', label: t('engagements.titre'), icone: IconEngagement },
            { to: '/rules', label: t('regles.titre'), icone: IconRegles },
            { to: '/forms', label: t('formulaires.titre'), icone: IconFormulaire },
            { to: '/notifications', label: t('notifications.titre'), icone: IconNotification },
            { to: '/mail', label: t('courriel.titre'), icone: IconCourriel },
            { to: '/surveys', label: t('enquetes.titre'), icone: IconEnquete },
          ],
        },
        {
          titre: t('navigation.groupes.administration'),
          entrees: [
            { to: '/entities', label: t('navigation.entites'), icone: IconEntites },
            {
              to: '/admin/users',
              label: t('administration.utilisateurs.titre'),
              icone: IconUtilisateurs,
            },
            {
              to: '/admin/groups',
              label: t('administration.groupes.titre'),
              icone: IconGroupes,
            },
            {
              to: '/admin/profiles',
              label: t('administration.profils.titre'),
              icone: IconDroits,
            },
          ],
        },
      ];

  // Le tiroir se referme à chaque navigation : le laisser ouvert masquerait la
  // page qu'on vient de demander.
  useEffect(() => {
    setOuvert(false);
  }, [location.pathname]);

  const contexteSlot = {
    locale: i18n.language,
    entity: session.entity,
    profile: session.profile,
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Voile du tiroir, sur petit écran seulement. */}
      {ouvert && (
        <button
          type="button"
          aria-label={t('navigation.fermerMenu')}
          onClick={() => {
            setOuvert(false);
          }}
          className="fixed inset-0 z-30 bg-ink/30 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0',
          ouvert ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <span className="grid size-7 place-items-center rounded-lg bg-brand text-sm font-bold text-on-brand">
            T
          </span>
          <span className="text-base font-semibold tracking-tight">Tick&amp;</span>

          <button
            type="button"
            aria-label={t('navigation.fermerMenu')}
            onClick={() => {
              setOuvert(false);
            }}
            className="ml-auto rounded-md p-1 text-faint hover:text-ink lg:hidden"
          >
            <IconFermer className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {sections.map((groupe) => (
            <div key={groupe.titre} className="space-y-1">
              <p className="px-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
                {groupe.titre}
              </p>
              {groupe.entrees.map((entree) => (
                <Lien
                  key={entree.to}
                  entree={entree}
                  onNavigate={() => {
                    setOuvert(false);
                  }}
                />
              ))}
            </div>
          ))}

          <PluginSlot name="app.sidebar" className="space-y-1" context={contexteSlot} />
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-ink">
              {initiales(session.user.displayName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {session.user.displayName}
              </span>
              <span className="block truncate text-xs text-faint">{session.profile.name}</span>
            </span>
            <button
              type="button"
              onClick={onLogout}
              title={t('session.deconnexion')}
              aria-label={t('session.deconnexion')}
              className="rounded-md p-1.5 text-faint transition-colors hover:bg-sunken hover:text-ink"
            >
              <IconSortie className="size-[18px]" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            aria-label={t('navigation.ouvrirMenu')}
            onClick={() => {
              setOuvert(true);
            }}
            className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink lg:hidden"
          >
            <IconMenu className="size-5" />
          </button>

          {/* Le selecteur prend la place restante et sait retrecir : sur
              telephone, la barre n'a pas de quoi loger un nom d'entite entier. */}
          <div className="min-w-0 flex-1">
            <ContextSwitcher session={session} />
          </div>

          <PluginSlot
            name="app.header"
            className="hidden items-center gap-2 md:flex"
            context={contexteSlot}
          />

          <div className="flex shrink-0 items-center gap-2">
            <SelecteurTheme />

            <select
              value={i18n.language}
              aria-label={t('apparence.langue')}
              onChange={(event) => {
                changeLocale(event.target.value);
              }}
              className="hidden h-8 rounded-lg border border-line bg-surface px-2 text-xs text-muted transition-colors hover:border-line-strong sm:block"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

/** Initiales d'un nom affiché, pour la pastille d'identité. */
function initiales(nom: string): string {
  const morceaux = nom.trim().split(/\s+/).slice(0, 2);

  return morceaux.map((morceau) => morceau[0]?.toUpperCase() ?? '').join('') || '?';
}
