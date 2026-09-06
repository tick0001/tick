import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { recurrenceStepSchema, type RecurrenceStep } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';

const VIDE = {
  name: '',
  content: '',
  templateId: 0,
  step: 'weekly' as RecurrenceStep,
  interval: 1,
  beginAt: '',
  endAt: '',
  createAheadMinutes: 0,
  isActive: true,
};

/**
 * Tickets récurrents.
 *
 * Le gabarit est obligatoire : c'est lui qui porte le type, la catégorie et les
 * acteurs du ticket produit. La récurrence n'ajoute que le titre, la
 * description et le calendrier.
 */
export function RecurringPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState(VIDE);
  const [message, setMessage] = useState('');

  const liste = useQuery({ queryKey: ['recurring'], queryFn: api.recurring, retry: false });
  const gabarits = useQuery({ queryKey: ['templates'], queryFn: api.templates, retry: false });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['recurring'] });
  };

  const enregistrer = useMutation({
    mutationFn: () =>
      api.saveRecurring({
        name: saisie.name,
        content: saisie.content,
        isActive: saisie.isActive,
        templateId: saisie.templateId,
        step: saisie.step,
        interval: saisie.interval,
        beginAt: new Date(saisie.beginAt).toISOString(),
        endAt: saisie.endAt ? new Date(saisie.endAt).toISOString() : null,
        createAheadMinutes: saisie.createAheadMinutes,
      }),
    onSuccess: async () => {
      setSaisie(VIDE);
      setOuvert(false);
      await rafraichir();
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteRecurring(id),
    onSuccess: rafraichir,
  });

  const executer = useMutation({
    mutationFn: api.runRecurring,
    onSuccess: async (resultat) => {
      setMessage(`${String(resultat.created)} ${t('recurrence.executee')}`);
      await rafraichir();
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const controle =
    'rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950';

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (saisie.name.trim() && saisie.templateId > 0 && saisie.beginAt) enregistrer.mutate();
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t('recurrence.description')}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={executer.isPending}
            onClick={() => {
              executer.mutate();
            }}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t('recurrence.executer')}
          </button>
          <button
            type="button"
            onClick={() => {
              setOuvert((valeur) => !valeur);
            }}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t('recurrence.nouveau')}
          </button>
        </div>
      </div>

      {message && <p className="text-sm text-neutral-500">{message}</p>}

      {ouvert && (
        <form
          onSubmit={soumettre}
          className="grid gap-2 rounded-lg border border-neutral-200 p-4 sm:grid-cols-2 dark:border-neutral-800"
        >
          <label className="space-y-0.5 sm:col-span-2">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              {t('recurrence.nom')}
            </span>
            <input
              value={saisie.name}
              onChange={(event) => {
                setSaisie((precedent) => ({ ...precedent, name: event.target.value }));
              }}
              className={`${controle} w-full`}
            />
          </label>

          <label className="space-y-0.5 sm:col-span-2">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              {t('itil.formulaire.contenu')}
            </span>
            <textarea
              value={saisie.content}
              rows={2}
              onChange={(event) => {
                setSaisie((precedent) => ({ ...precedent, content: event.target.value }));
              }}
              className={`${controle} w-full`}
            />
          </label>

          <label className="space-y-0.5">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              {t('recurrence.gabarit')}
            </span>
            <select
              value={saisie.templateId}
              onChange={(event) => {
                setSaisie((precedent) => ({ ...precedent, templateId: Number(event.target.value) }));
              }}
              className={`${controle} w-full`}
            >
              <option value={0}>—</option>
              {(gabarits.data ?? []).map((gabarit) => (
                <option key={gabarit.id} value={gabarit.id}>
                  {gabarit.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-2">
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-neutral-500">
                {t('recurrence.intervalle')}
              </span>
              <input
                type="number"
                min={1}
                value={saisie.interval}
                onChange={(event) => {
                  setSaisie((precedent) => ({ ...precedent, interval: Number(event.target.value) }));
                }}
                className={`${controle} w-20`}
              />
            </label>
            <select
              value={saisie.step}
              onChange={(event) => {
                setSaisie((precedent) => ({
                  ...precedent,
                  step: recurrenceStepSchema.parse(event.target.value),
                }));
              }}
              className={controle}
            >
              {recurrenceStepSchema.options.map((valeur) => (
                <option key={valeur} value={valeur}>
                  {t(`recurrence.pas.${valeur}`)}
                </option>
              ))}
            </select>
          </div>

          <label className="space-y-0.5">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              {t('recurrence.debut')}
            </span>
            <input
              type="datetime-local"
              value={saisie.beginAt}
              onChange={(event) => {
                setSaisie((precedent) => ({ ...precedent, beginAt: event.target.value }));
              }}
              className={`${controle} w-full`}
            />
          </label>

          <label className="space-y-0.5">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              {t('recurrence.fin')}
            </span>
            <input
              type="datetime-local"
              value={saisie.endAt}
              onChange={(event) => {
                setSaisie((precedent) => ({ ...precedent, endAt: event.target.value }));
              }}
              className={`${controle} w-full`}
            />
          </label>

          <label className="space-y-0.5">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              {t('recurrence.avance')}
            </span>
            <input
              type="number"
              min={0}
              value={saisie.createAheadMinutes}
              onChange={(event) => {
                setSaisie((precedent) => ({
                  ...precedent,
                  createAheadMinutes: Number(event.target.value),
                }));
              }}
              className={`${controle} w-full`}
            />
          </label>

          <div className="flex items-center gap-3 sm:col-span-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={saisie.isActive}
                onChange={(event) => {
                  setSaisie((precedent) => ({ ...precedent, isActive: event.target.checked }));
                }}
              />
              {t('recurrence.active')}
            </label>

            <button
              type="submit"
              disabled={enregistrer.isPending}
              className="ml-auto rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('planning.enregistrer')}
            </button>
          </div>

          {enregistrer.error && (
            <p className="text-xs text-red-600 sm:col-span-2 dark:text-red-400">
              {enregistrer.error.message}
            </p>
          )}
        </form>
      )}

      {liste.error instanceof ApiError && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {liste.error.message}
        </p>
      )}

      {liste.data && liste.data.length === 0 && (
        <p className="text-sm text-neutral-500">{t('recurrence.aucun')}</p>
      )}

      {liste.data && liste.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2 font-medium">{t('recurrence.nom')}</th>
                <th className="px-3 py-2 font-medium">{t('recurrence.gabarit')}</th>
                <th className="px-3 py-2 font-medium">{t('recurrence.periodicite')}</th>
                <th className="px-3 py-2 font-medium">{t('recurrence.prochaine')}</th>
                <th className="px-3 py-2 font-medium">{t('recurrence.occurrences')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.entite')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {liste.data.map((recurrence) => (
                <tr
                  key={recurrence.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{recurrence.name}</span>
                    {!recurrence.isActive && (
                      <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700">
                        ⏸
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{recurrence.templateName}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {recurrence.interval} {t(`recurrence.pas.${recurrence.step}`)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-500">
                    {recurrence.nextOccurrenceAt
                      ? dates.format(new Date(recurrence.nextOccurrenceAt))
                      : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-neutral-500">{recurrence.runCount}</td>
                  <td className="px-3 py-2 text-neutral-500">{recurrence.entityName}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        supprimer.mutate(recurrence.id);
                      }}
                      className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                    >
                      {t('planning.supprimer')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
