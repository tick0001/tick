import { useMutation, useQuery } from '@tanstack/react-query';
import type { PublicSurvey } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { api } from '@/lib/api';

const NOTES = [1, 2, 3, 4, 5];

/**
 * Formulaire public d'enquête.
 *
 * Aucune session : le jeton de l'URL fait autorisation. C'est ce qui permet de
 * répondre depuis un client de messagerie, sans compte — la seule façon
 * d'obtenir un taux de réponse qui vaille quelque chose.
 */
export function SatisfactionPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const [note, setNote] = useState<number | null>(null);
  const [commentaire, setCommentaire] = useState('');

  const enquete = useQuery({
    queryKey: ['satisfaction', token],
    queryFn: () => api.survey(token),
    retry: false,
  });

  const repondre = useMutation({
    mutationFn: () => api.answerSurvey(token, { rating: note ?? 3, comment: commentaire || null }),
  });

  const encadre =
    'mx-auto max-w-lg space-y-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800';

  if (enquete.error) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className={encadre}>{t('satisfaction.introuvable')}</p>
      </main>
    );
  }

  if (!enquete.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-sm text-neutral-500">{t('commun.chargement')}</p>
      </main>
    );
  }

  const detail: PublicSurvey = enquete.data;
  const repondu = detail.answered || repondre.isSuccess;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <section className={encadre}>
        <header className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{t('satisfaction.titre')}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            #{detail.ticketId} — {detail.ticketName}
          </p>
        </header>

        {repondu ? (
          <p className="text-sm">{t('satisfaction.merci')}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (note !== null) repondre.mutate();
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('satisfaction.note')}</legend>
              <div className="flex gap-2">
                {NOTES.map((valeur) => (
                  <button
                    key={valeur}
                    type="button"
                    aria-pressed={note === valeur}
                    onClick={() => {
                      setNote(valeur);
                    }}
                    className={`h-10 w-10 rounded-md border text-sm transition ${
                      note === valeur
                        ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                        : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {valeur}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block space-y-1">
              <span className="text-sm font-medium">{t('satisfaction.commentaire')}</span>
              <textarea
                className="h-28 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                value={commentaire}
                onChange={(event) => {
                  setCommentaire(event.target.value);
                }}
              />
            </label>

            {repondre.error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {repondre.error instanceof Error ? repondre.error.message : ''}
              </p>
            )}

            <button
              type="submit"
              disabled={note === null}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white transition disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('satisfaction.envoyer')}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
