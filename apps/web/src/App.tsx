import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ContextSwitcher } from '@/components/ContextSwitcher';
import { ApiError, api } from '@/lib/api';
import { changeLocale } from '@/lib/i18n';
import { EntitiesPage } from '@/pages/EntitiesPage';
import { LoginPage } from '@/pages/LoginPage';

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
      queryClient.clear();
    },
  });

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

  return (
    <div className="min-h-dvh">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <span className="text-lg font-semibold tracking-tight">Tick&amp;</span>

          <ContextSwitcher session={session.data} />

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

      <main className="mx-auto max-w-6xl p-6">
        <EntitiesPage />
      </main>
    </div>
  );
}
