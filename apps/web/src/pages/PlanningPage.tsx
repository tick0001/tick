import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlanningEntry } from '@tick/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { RecurringPanel } from '@/components/RecurringPanel';
import { ApiError, api } from '@/lib/api';

type Vue = 'jour' | 'semaine' | 'mois';

const DUREE: Record<Vue, number> = { jour: 1, semaine: 7, mois: 31 };

/** Minuit local du jour donné, décalé de `jours`. */
function minuit(depuis: Date, jours = 0): Date {
  const date = new Date(depuis);

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + jours);

  return date;
}

/** Clé de regroupement d'une entrée : sa date de début, en local. */
function jourDe(valeur: string): string {
  const date = new Date(valeur);

  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Chemin de l'objet porteur d'une tâche. */
function chemin(entree: PlanningEntry): string | null {
  if (!entree.itilType || !entree.itilId) return null;
  if (entree.itilType === 'ticket') return `/tickets/${String(entree.itilId)}`;

  return `/itil/${entree.itilType === 'problem' ? 'problems' : 'changes'}/${String(entree.itilId)}`;
}

/**
 * Planning des interventions.
 *
 * Une liste groupée par jour, pas une grille horaire. Une grille suppose que
 * les créneaux ne se chevauchent pas, or les chevauchements sont exactement ce
 * qu'il faut montrer ici : les dessiner côte à côte les rendrait moins visibles
 * qu'une mention explicite.
 */
export function PlanningPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [vue, setVue] = useState<Vue>('semaine');
  const [ancre, setAncre] = useState(() => minuit(new Date()));
  const [technicien, setTechnicien] = useState('');
  const [onglet, setOnglet] = useState<'calendrier' | 'recurrence'>('calendrier');

  const [ouvertAbsence, setOuvertAbsence] = useState(false);
  const [absence, setAbsence] = useState({ beginAt: '', endAt: '', reason: '' });

  const fenetre = useMemo(() => {
    const debut = vue === 'mois' ? minuit(new Date(ancre.getFullYear(), ancre.getMonth(), 1)) : ancre;

    return { from: debut.toISOString(), to: minuit(debut, DUREE[vue]).toISOString() };
  }, [ancre, vue]);

  const filtre = useMemo(
    () => ({
      ...fenetre,
      ...(technicien ? { technicianId: Number(technicien) } : {}),
    }),
    [fenetre, technicien],
  );

  const planning = useQuery({
    queryKey: ['planning', filtre],
    queryFn: () => api.planning(filtre),
    retry: false,
  });

  const declarer = useMutation({
    mutationFn: () =>
      api.createUnavailability({
        userId: Number(technicien),
        beginAt: new Date(absence.beginAt).toISOString(),
        endAt: new Date(absence.endAt).toISOString(),
        reason: absence.reason,
      }),
    onSuccess: async () => {
      setOuvertAbsence(false);
      setAbsence({ beginAt: '', endAt: '', reason: '' });
      await queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
  });

  const retirer = useMutation({
    mutationFn: (id: number) => api.deleteUnavailability(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
  });

  const entrees = planning.data ?? [];
  const conflits = entrees.filter((entree) => entree.conflicts.length > 0).length;

  // Les techniciens proposés sont ceux que la fenêtre montre : demander la
  // liste complète des utilisateurs pour filtrer un planning de cinq lignes
  // coûterait une requête de plus pour un choix moins pertinent.
  const techniciens = useMemo(() => {
    const connus = new Map<number, string>();

    for (const entree of entrees) {
      if (entree.userId !== null) connus.set(entree.userId, entree.userName ?? '');
    }

    return [...connus.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entrees]);

  const parJour = useMemo(() => {
    const groupes = new Map<string, PlanningEntry[]>();

    for (const entree of entrees) {
      const cle = jourDe(entree.beginAt);
      const liste = groupes.get(cle) ?? [];

      liste.push(entree);
      groupes.set(cle, liste);
    }

    return [...groupes.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entrees]);

  const heures = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' });
  const jourLong = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full' });

  const soumettreAbsence = (event: FormEvent): void => {
    event.preventDefault();
    if (technicien && absence.beginAt && absence.endAt) declarer.mutate();
  };

  const controle =
    'rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950';

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('planning.titre')}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('planning.description')}</p>
      </header>

      <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
        {(['calendrier', 'recurrence'] as const).map((valeur) => (
          <button
            key={valeur}
            type="button"
            onClick={() => {
              setOnglet(valeur);
            }}
            className={`px-3 py-1.5 text-xs transition ${
              onglet === valeur
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            {valeur === 'calendrier' ? t('planning.titre') : t('recurrence.titre')}
          </button>
        ))}
      </div>

      {onglet === 'recurrence' && <RecurringPanel />}

      {onglet === 'calendrier' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
              {(['jour', 'semaine', 'mois'] as const).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  onClick={() => {
                    setVue(valeur);
                  }}
                  className={`px-3 py-1.5 text-xs transition ${
                    vue === valeur
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  {t(`planning.vues.${valeur}`)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setAncre((precedent) => minuit(precedent, -DUREE[vue]));
                }}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => {
                  setAncre(minuit(new Date()));
                }}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {jourLong.format(ancre)}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAncre((precedent) => minuit(precedent, DUREE[vue]));
                }}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                →
              </button>
            </div>

            <select
              value={technicien}
              onChange={(event) => {
                setTechnicien(event.target.value);
              }}
              className={controle}
            >
              <option value="">{t('planning.tous')}</option>
              {techniciens.map(([id, nom]) => (
                <option key={id} value={id}>
                  {nom}
                </option>
              ))}
            </select>

            <a
              href={api.planningIcalUrl(filtre)}
              className="ml-auto rounded-md border border-neutral-300 px-3 py-1.5 text-xs transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t('planning.exporterIcal')}
            </a>

            <button
              type="button"
              disabled={!technicien}
              title={technicien ? undefined : t('planning.technicien')}
              onClick={() => {
                setOuvertAbsence((valeur) => !valeur);
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t('planning.ajouterIndisponibilite')}
            </button>
          </div>

          {ouvertAbsence && (
            <form
              onSubmit={soumettreAbsence}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <label className="space-y-0.5">
                <span className="block text-xs uppercase tracking-wide text-neutral-500">
                  {t('planning.debut')}
                </span>
                <input
                  type="datetime-local"
                  value={absence.beginAt}
                  onChange={(event) => {
                    setAbsence((precedent) => ({ ...precedent, beginAt: event.target.value }));
                  }}
                  className={controle}
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-xs uppercase tracking-wide text-neutral-500">
                  {t('planning.fin')}
                </span>
                <input
                  type="datetime-local"
                  value={absence.endAt}
                  onChange={(event) => {
                    setAbsence((precedent) => ({ ...precedent, endAt: event.target.value }));
                  }}
                  className={controle}
                />
              </label>
              <label className="flex-1 space-y-0.5">
                <span className="block text-xs uppercase tracking-wide text-neutral-500">
                  {t('planning.motif')}
                </span>
                <input
                  value={absence.reason}
                  onChange={(event) => {
                    setAbsence((precedent) => ({ ...precedent, reason: event.target.value }));
                  }}
                  className={`${controle} w-full`}
                />
              </label>
              <button
                type="submit"
                disabled={declarer.isPending}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {t('planning.enregistrer')}
              </button>
              {declarer.error && (
                <p className="w-full text-xs text-red-600 dark:text-red-400">
                  {declarer.error.message}
                </p>
              )}
            </form>
          )}

          {conflits > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {conflits} {t('planning.conflits')}
            </p>
          )}

          {planning.error instanceof ApiError && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {planning.error.message}
            </p>
          )}

          {planning.isPending && (
            <p className="text-sm text-neutral-500">{t('commun.chargement')}</p>
          )}

          {planning.data && entrees.length === 0 && (
            <p className="text-sm text-neutral-500">{t('planning.aucune')}</p>
          )}

          <div className="space-y-4">
            {parJour.map(([cle, liste]) => (
              <div key={cle} className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {jourLong.format(new Date(`${cle}T00:00:00`))}
                </h3>

                <ul className="space-y-1">
                  {liste.map((entree) => {
                    const lien = chemin(entree);

                    return (
                      <li
                        key={`${entree.kind}-${String(entree.id)}`}
                        className={`flex flex-wrap items-baseline gap-x-2 rounded-lg border p-2 text-sm ${
                          entree.conflicts.length > 0
                            ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
                            : 'border-neutral-200 dark:border-neutral-800'
                        }`}
                      >
                        <span className="tabular-nums text-neutral-500">
                          {heures.format(new Date(entree.beginAt))} –{' '}
                          {heures.format(new Date(entree.endAt))}
                        </span>

                        {entree.kind === 'unavailability' && (
                          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700">
                            {t('planning.indisponibilite')}
                          </span>
                        )}

                        <span className="font-medium">{entree.title}</span>

                        {lien && (
                          <Link
                            to={lien}
                            className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                          >
                            #{entree.itilId}
                          </Link>
                        )}

                        <span className="text-xs text-neutral-500">{entree.userName ?? '—'}</span>

                        {entree.conflicts.length > 0 && (
                          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                            {t('planning.conflit')}
                          </span>
                        )}

                        {entree.kind === 'unavailability' && (
                          <button
                            type="button"
                            onClick={() => {
                              retirer.mutate(entree.id);
                            }}
                            className="ml-auto text-xs text-neutral-500 underline-offset-2 hover:underline"
                          >
                            {t('planning.supprimer')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
