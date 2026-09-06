import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { ApiError, api } from '@/lib/api';
import { loadPluginClients, resetPluginClients } from '@/lib/plugins';
import { CataloguePage } from '@/pages/CataloguePage';
import { EntitiesPage } from '@/pages/EntitiesPage';
import { FaqPage } from '@/pages/FaqPage';
import { FormsPage } from '@/pages/FormsPage';
import { GroupsPage } from '@/pages/GroupsPage';
import { ItilObjectPage } from '@/pages/ItilObjectPage';
import { ItilObjectsPage } from '@/pages/ItilObjectsPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { LoginPage } from '@/pages/LoginPage';
import { NewTicketPage } from '@/pages/NewTicketPage';
import { MailPage } from '@/pages/MailPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { PlanningPage } from '@/pages/PlanningPage';
import { ProfilesPage } from '@/pages/ProfilesPage';
import { RulesPage } from '@/pages/RulesPage';
import { SatisfactionPage } from '@/pages/SatisfactionPage';
import { SearchPage } from '@/pages/SearchPage';
import { StatsPage } from '@/pages/StatsPage';
import { SurveysPage } from '@/pages/SurveysPage';
import { ServiceLevelsPage } from '@/pages/ServiceLevelsPage';
import { TicketPage } from '@/pages/TicketPage';
import { TicketsPage } from '@/pages/TicketsPage';
import { UsersPage } from '@/pages/UsersPage';

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
  const { t } = useTranslation();
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
      <main className="grid min-h-dvh place-items-center">
        <p className="text-sm text-muted">{t('commun.chargement')}</p>
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

  return (
    <AppShell
      session={session.data}
      onLogout={() => {
        deconnexion.mutate();
      }}
    >
      <Routes>
        <Route
          path="/"
          element={<Navigate to={simplifiee ? '/catalogue' : '/tickets'} replace />}
        />
        <Route path="/tickets" element={<TicketsPage session={session.data} />} />
        <Route path="/tickets/new" element={<NewTicketPage />} />
        <Route path="/tickets/:id" element={<TicketPage />} />
        <Route path="/itil/problems" element={<ItilObjectsPage kind="problem" />} />
        <Route path="/itil/problems/:id" element={<ItilObjectPage kind="problem" />} />
        <Route path="/itil/changes" element={<ItilObjectsPage kind="change" />} />
        <Route path="/itil/changes/:id" element={<ItilObjectPage kind="change" />} />
        <Route path="/planning" element={<PlanningPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/entities" element={<EntitiesPage session={session.data} />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/groups" element={<GroupsPage />} />
        <Route path="/admin/profiles" element={<ProfilesPage />} />
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
    </AppShell>
  );
}
