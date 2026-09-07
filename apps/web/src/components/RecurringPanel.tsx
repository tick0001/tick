import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { recurrenceStepSchema, type RecurrenceStep } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';

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
  const peutEcrire = usePeut('recurrence', 'update');
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
  const controle = 'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm';

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (saisie.name.trim() && saisie.templateId > 0 && saisie.beginAt) enregistrer.mutate();
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted">{t('recurrence.description')}</p>

        <div className="flex gap-2">
          {peutEcrire && (
            <>
              <button
                type="button"
                disabled={executer.isPending}
                onClick={() => {
                  executer.mutate();
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-sunken disabled:opacity-60"
              >
                {t('recurrence.executer')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOuvert((valeur) => !valeur);
                }}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover"
              >
                {t('recurrence.nouveau')}
              </button>
            </>
          )}
        </div>
      </div>

      {message && <p className="text-sm text-muted">{message}</p>}

      {ouvert && (
        <form
          onSubmit={soumettre}
          className="grid gap-2 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-2"
        >
          <label className="space-y-0.5 sm:col-span-2">
            <span className="block text-xs uppercase tracking-wide text-muted">
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
            <span className="block text-xs uppercase tracking-wide text-muted">
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
            <span className="block text-xs uppercase tracking-wide text-muted">
              {t('recurrence.gabarit')}
            </span>
            <select
              value={saisie.templateId}
              onChange={(event) => {
                setSaisie((precedent) => ({
                  ...precedent,
                  templateId: Number(event.target.value),
                }));
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
              <span className="block text-xs uppercase tracking-wide text-muted">
                {t('recurrence.intervalle')}
              </span>
              <input
                type="number"
                min={1}
                value={saisie.interval}
                onChange={(event) => {
                  setSaisie((precedent) => ({
                    ...precedent,
                    interval: Number(event.target.value),
                  }));
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
            <span className="block text-xs uppercase tracking-wide text-muted">
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
            <span className="block text-xs uppercase tracking-wide text-muted">
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
            <span className="block text-xs uppercase tracking-wide text-muted">
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
              className="ml-auto rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover disabled:opacity-50"
            >
              {t('planning.enregistrer')}
            </button>
          </div>

          {enregistrer.error && (
            <p className="text-xs text-critical sm:col-span-2">{enregistrer.error.message}</p>
          )}
        </form>
      )}

      {liste.error instanceof ApiError && (
        <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
          {liste.error.message}
        </p>
      )}

      {liste.data && liste.data.length === 0 && (
        <p className="text-sm text-muted">{t('recurrence.aucun')}</p>
      )}

      {liste.data && liste.data.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sunken text-xs uppercase tracking-wide text-muted bg-surface">
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
                <tr key={recurrence.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{recurrence.name}</span>
                    {!recurrence.isActive && (
                      <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs">⏸</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{recurrence.templateName}</td>
                  <td className="px-3 py-2 text-muted">
                    {recurrence.interval} {t(`recurrence.pas.${recurrence.step}`)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">
                    {recurrence.nextOccurrenceAt
                      ? dates.format(new Date(recurrence.nextOccurrenceAt))
                      : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">{recurrence.runCount}</td>
                  <td className="px-3 py-2 text-muted">{recurrence.entityName}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        supprimer.mutate(recurrence.id);
                      }}
                      className="text-xs text-muted underline-offset-2 hover:underline"
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
