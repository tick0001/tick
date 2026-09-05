import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import { ContextSwitcher } from '@/components/ContextSwitcher';
import { PluginSlot } from '@/components/PluginSlot';
import { ApiError, api } from '@/lib/api';
import { changeLocale } from '@/lib/i18n';
import { loadPluginClients, resetPluginClients } from '@/lib/plugins';
import { EntitiesPage } from '@/pages/EntitiesPage';
import { LoginPage } from '@/pages/LoginPage';
import { TicketPage } from '@/pages/TicketPage';
import { TicketsPage } from '@/pages/TicketsPage';

export function App() {
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
    <BrowserRouter>
      <div className="min-h-dvh">
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
            <span className="text-lg font-semibold tracking-tight">Tick&amp;</span>

            <nav className="flex items-center gap-1">
              <NavLink to="/tickets" className={lienClasses}>
                {t('navigation.tickets')}
              </NavLink>
              <NavLink to="/entities" className={lienClasses}>
                {t('navigation.entites')}
              </NavLink>
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
            <Route path="/" element={<Navigate to="/tickets" replace />} />
            <Route path="/tickets" element={<TicketsPage session={session.data} />} />
            <Route path="/tickets/:id" element={<TicketPage />} />
            <Route path="/entities" element={<EntitiesPage session={session.data} />} />
            <Route path="*" element={<Navigate to="/tickets" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
