import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import { ContextSwitcher } from '@/components/ContextSwitcher';
import { PluginSlot } from '@/components/PluginSlot';
import { ApiError, api } from '@/lib/api';
import { changeLocale } from '@/lib/i18n';
import { loadPluginClients, resetPluginClients } from '@/lib/plugins';
import { CataloguePage } from '@/pages/CataloguePage';
import { EntitiesPage } from '@/pages/EntitiesPage';
import { FaqPage } from '@/pages/FaqPage';
import { FormsPage } from '@/pages/FormsPage';
import { ItilObjectPage } from '@/pages/ItilObjectPage';
import { ItilObjectsPage } from '@/pages/ItilObjectsPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { LoginPage } from '@/pages/LoginPage';
import { NewTicketPage } from '@/pages/NewTicketPage';
import { MailPage } from '@/pages/MailPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { PlanningPage } from '@/pages/PlanningPage';
import { RulesPage } from '@/pages/RulesPage';
import { SatisfactionPage } from '@/pages/SatisfactionPage';
import { SearchPage } from '@/pages/SearchPage';
import { StatsPage } from '@/pages/StatsPage';
import { SurveysPage } from '@/pages/SurveysPage';
import { ServiceLevelsPage } from '@/pages/ServiceLevelsPage';
import { TicketPage } from '@/pages/TicketPage';
import { TicketsPage } from '@/pages/TicketsPage';

/**
 * Le routeur enveloppe l'ecran de connexion, et non l'inverse.
 *
 * L'enquete de satisfaction et la FAQ publique se consultent sans compte : les
 * placer derriere le controle de session les rendrait inaccessibles a ceux a
 * qui elles s'adressent.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/satisfaction/:token" element={<SatisfactionPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="*" element={<Application />} />
      </Routes>
    </BrowserRouter>
  );
}

function Application() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ['session'],
    queryFn: api.session,
    // Un 401 signifie « pas connecté », pas « échec temporaire » : réessayer
    // ne ferait qu'allonger l'attente avant d'afficher l'écran de connexion.
    retry: false,
  });

  const deconnexion = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      resetPluginClients();
      queryClient.clear();
    },
  });

  // Les extensions d'interface se chargent une fois la session établie : elles
  // dépendent du contexte de travail, et l'API refuserait la liste avant.
  const connecte = Boolean(session.data);

  useEffect(() => {
    if (connecte) void loadPluginClients();
  }, [connecte]);

  if (session.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-neutral-500">{t('commun.chargement')}</p>
      </main>
    );
  }

  if (!session.data || (session.error instanceof ApiError && session.error.status === 401)) {
    return <LoginPage />;
  }

  /**
   * Interface simplifiee.
   *
   * Portee par le profil actif, pas par l'utilisateur : la meme personne peut
   * etre technicienne sur une branche et simple demandeuse sur une autre, et
   * l'ecran doit suivre le contexte de travail.
   */
  const simplifiee = session.data.profile.interface === 'self_service';

  const contexteSlot = {
    locale: i18n.language,
    entity: session.data.entity,
    profile: session.data.profile,
  };

  const lienClasses = ({ isActive }: { isActive: boolean }): string =>
    `rounded-md px-2.5 py-1 text-sm transition ${
      isActive
        ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
        : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
    }`;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <span className="text-lg font-semibold tracking-tight">Tick&amp;</span>

          <nav className="flex items-center gap-1">
            <NavLink to="/catalogue" className={lienClasses}>
              {t('catalogue.titre')}
            </NavLink>
            <NavLink to="/tickets" className={lienClasses}>
              {simplifiee ? t('navigation.mesDemandes') : t('navigation.tickets')}
            </NavLink>
            <NavLink to="/knowledge" className={lienClasses}>
              {t('connaissance.titre')}
            </NavLink>

            {/* Un demandeur n'a que faire des ecrans de parametrage : les lui
                montrer pour qu'ils refusent l'acces serait pire que les taire. */}
            {!simplifiee && (
              <>
                <NavLink to="/itil/problems" className={lienClasses}>
                  {t('navigation.problemes')}
                </NavLink>
                <NavLink to="/itil/changes" className={lienClasses}>
                  {t('navigation.changements')}
                </NavLink>
                <NavLink to="/planning" className={lienClasses}>
                  {t('navigation.planning')}
                </NavLink>
                <NavLink to="/stats" className={lienClasses}>
                  {t('navigation.statistiques')}
                </NavLink>
                <NavLink to="/search" className={lienClasses}>
                  {t('recherche.titre')}
                </NavLink>
                <NavLink to="/entities" className={lienClasses}>
                  {t('navigation.entites')}
                </NavLink>
                <NavLink to="/service-levels" className={lienClasses}>
                  {t('engagements.titre')}
                </NavLink>
                <NavLink to="/rules" className={lienClasses}>
                  {t('regles.titre')}
                </NavLink>
                <NavLink to="/forms" className={lienClasses}>
                  {t('formulaires.titre')}
                </NavLink>
                <NavLink to="/notifications" className={lienClasses}>
                  {t('notifications.titre')}
                </NavLink>
                <NavLink to="/mail" className={lienClasses}>
                  {t('courriel.titre')}
                </NavLink>
                <NavLink to="/surveys" className={lienClasses}>
                  {t('enquetes.titre')}
                </NavLink>
              </>
            )}
          </nav>

          <ContextSwitcher session={session.data} />

          <PluginSlot
            name="app.header"
            className="flex items-center gap-2"
            context={contexteSlot}
          />

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">
              {session.data.user.displayName}
            </span>

            <select
              value={i18n.language}
              onChange={(event) => {
                changeLocale(event.target.value);
              }}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>

            <button
              type="button"
              onClick={() => {
                deconnexion.mutate();
              }}
              className="rounded-md border border-neutral-300 px-2.5 py-1 transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t('session.deconnexion')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-6">
        <Routes>
          <Route
            path="/"
            element={<Navigate to={simplifiee ? '/catalogue' : '/tickets'} replace />}
          />
          <Route path="/tickets" element={<TicketsPage session={session.data} />} />
          <Route path="/tickets/new" element={<NewTicketPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/tickets/:id" element={<TicketPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/itil/problems" element={<ItilObjectsPage kind="problem" />} />
          <Route path="/itil/problems/:id" element={<ItilObjectPage kind="problem" />} />
          <Route path="/itil/changes" element={<ItilObjectsPage kind="change" />} />
          <Route path="/itil/changes/:id" element={<ItilObjectPage kind="change" />} />
          <Route path="/entities" element={<EntitiesPage session={session.data} />} />
          <Route path="/service-levels" element={<ServiceLevelsPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/knowledge" element={<KnowledgePage session={session.data} />} />
          <Route path="/catalogue" element={<CataloguePage />} />
          <Route path="/forms" element={<FormsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/surveys" element={<SurveysPage session={session.data} />} />
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Routes>
      </main>
    </div>
  );
}
