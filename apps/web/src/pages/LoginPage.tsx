import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';

export function LoginPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const connexion = useMutation({
    mutationFn: () => api.login({ username, password }),
    onSuccess: (session) => {
      queryClient.setQueryData(['session'], session);
    },
  });

  const message =
    connexion.error instanceof ApiError && connexion.error.status === 401
      ? t('connexion.echec')
      : connexion.error
        ? t('connexion.indisponible')
        : null;

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    connexion.mutate();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        onSubmit={soumettre}
        className="w-full max-w-sm space-y-5 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tick&amp;</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t('connexion.sousTitre')}
          </p>
        </div>

        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t('connexion.identifiant')}</span>
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
              autoComplete="username"
              autoFocus
              required
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t('connexion.motDePasse')}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
            />
          </label>
        </div>

        {message && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={connexion.isPending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {connexion.isPending ? t('connexion.enCours') : t('connexion.valider')}
        </button>
      </form>
    </main>
  );
}
