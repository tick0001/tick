import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, Input } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

/**
 * Écran de connexion.
 *
 * Deux colonnes sur grand écran : le formulaire à gauche, un aplat de marque à
 * droite. La colonne de droite ne porte aucune information indispensable, et
 * disparaît en dessous de `lg` — c'est ce qui permet de la rendre ample sans
 * rien devoir réorganiser sur téléphone.
 */
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
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center p-6">
        <form onSubmit={soumettre} className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <span className="grid size-10 place-items-center rounded-xl bg-brand text-lg font-bold text-on-brand">
              T
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">Tick&amp;</h1>
            <p className="text-sm text-muted">{t('connexion.sousTitre')}</p>
          </div>

          <div className="space-y-4">
            <Field label={t('connexion.identifiant')}>
              <Input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
                autoComplete="username"
                autoFocus
                required
              />
            </Field>

            <Field label={t('connexion.motDePasse')}>
              <Input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                autoComplete="current-password"
                required
              />
            </Field>
          </div>

          {message && (
            <p
              role="alert"
              className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical-ink"
            >
              {message}
            </p>
          )}

          <Button
            type="submit"
            variante="primaire"
            disabled={connexion.isPending}
            className="w-full"
          >
            {connexion.isPending ? t('connexion.enCours') : t('connexion.valider')}
          </Button>
        </form>
      </div>

      <aside className="relative hidden overflow-hidden bg-brand lg:block">
        {/* Motif discret : deux halos, sans image a telecharger. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(60rem 40rem at 20% 15%, rgb(255 255 255 / 0.22), transparent 60%),' +
              'radial-gradient(50rem 40rem at 85% 85%, rgb(255 255 255 / 0.14), transparent 55%)',
          }}
        />

        <div className="relative flex h-full flex-col justify-end gap-3 p-12 text-on-brand">
          <p className="max-w-md text-2xl leading-snug font-semibold text-balance">
            {t('connexion.accroche')}
          </p>
          <p className="max-w-md text-sm opacity-80">{t('connexion.accrocheDetail')}</p>
        </div>
      </aside>
    </main>
  );
}
