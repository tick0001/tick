import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { ApiError, api } from '@/lib/api';
import { loadPluginClients, resetPluginClients } from '@/lib/plugins';
import { useRetourAccueilALaDeconnexion } from '@/lib/session-navigation';
import { premierReglageAccessible } from '@/lib/navigation';
import { SessionProvider } from '@/lib/session';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { CataloguePage } from '@/pages/CataloguePage';
import { DirectoriesPage } from '@/pages/DirectoriesPage';
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
import { SettingsPage } from '@/pages/SettingsPage';
import { StatsPage } from '@/pages/StatsPage';
import { SurveysPage } from '@/pages/SurveysPage';
import { ServiceLevelsPage } from '@/pages/ServiceLevelsPage';
import { TicketConversationPage } from '@/pages/TicketConversationPage';
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

  /**
   * Une seule définition de « connecté ».
   *
   * Sur un échec de rafraîchissement, TanStack Query **conserve** la dernière
   * donnée : `session.data` reste renseignée alors que le serveur vient de
   * répondre 401. Juger la connexion sur la seule présence des données ferait
   * donc diverger deux décisions qui doivent s'accorder — celle d'afficher
   * l'écran de connexion, et celle de charger les extensions ou de remettre
   * l'adresse à zéro.
   */
  const expiree = session.error instanceof ApiError && session.error.status === 401;
  const connecte = Boolean(session.data) && !expiree;

  useEffect(() => {
    if (connecte) void loadPluginClients();
  }, [connecte]);

  useRetourAccueilALaDeconnexion(connecte);

  if (session.isPending) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="text-sm text-muted">{t('commun.chargement')}</p>
      </main>
    );
  }

  if (!connecte || !session.data) {
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
    <SessionProvider session={session.data}>
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
          {/* Le demandeur lit sa demande comme une conversation, le technicien
            comme une fiche : ce ne sont pas deux mises en page du meme ecran,
            mais deux besoins differents. Voir `TicketConversationPage`. */}
          <Route
            path="/tickets/:id"
            element={
              simplifiee ? <TicketConversationPage session={session.data} /> : <TicketPage />
            }
          />
          <Route path="/itil/problems" element={<ItilObjectsPage kind="problem" />} />
          <Route path="/itil/problems/:id" element={<ItilObjectPage kind="problem" />} />
          <Route path="/itil/changes" element={<ItilObjectsPage kind="change" />} />
          <Route path="/itil/changes/:id" element={<ItilObjectPage kind="change" />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/catalogue" element={<CataloguePage />} />

          {/* La configuration est une zone : la barre laterale devient la sienne,
            et `/settings` seul ouvre le premier ecran. */}
          <Route
          path="/settings"
          element={<Navigate to={premierReglageAccessible(session.data) ?? '/'} replace />}
        />
          <Route path="/settings/service-levels" element={<ServiceLevelsPage />} />
          <Route path="/settings/rules" element={<RulesPage />} />
          <Route path="/settings/forms" element={<FormsPage />} />
          <Route path="/settings/categories" element={<CategoriesPage />} />
          <Route path="/settings/notifications" element={<NotificationsPage />} />
          <Route path="/settings/mail" element={<MailPage />} />
          <Route path="/settings/surveys" element={<SurveysPage session={session.data} />} />
          <Route path="/settings/entities" element={<EntitiesPage session={session.data} />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/groups" element={<GroupsPage />} />
          <Route path="/settings/profiles" element={<ProfilesPage />} />
          <Route path="/settings/directories" element={<DirectoriesPage />} />
          <Route path="/settings/general" element={<SettingsPage session={session.data} />} />

          {/* Anciennes adresses : un signet ne doit pas tomber sur une page
            d'accueil sans explication. */}
          {[
            ['/entities', '/settings/entities'],
            ['/service-levels', '/settings/service-levels'],
            ['/rules', '/settings/rules'],
            ['/forms', '/settings/forms'],
            ['/notifications', '/settings/notifications'],
            ['/mail', '/settings/mail'],
            ['/surveys', '/settings/surveys'],
            ['/admin/users', '/settings/users'],
            ['/admin/groups', '/settings/groups'],
            ['/admin/profiles', '/settings/profiles'],
            ['/admin/directories', '/settings/directories'],
            ['/admin/settings', '/settings/general'],
          ].map(([ancienne, nouvelle]) => (
            <Route
              key={ancienne}
              path={ancienne}
              element={<Navigate to={nouvelle as string} replace />}
            />
          ))}
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Routes>
      </AppShell>
    </SessionProvider>
  );
}
