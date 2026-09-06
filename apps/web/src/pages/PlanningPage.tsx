import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlanningEntry } from '@tick/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { RecurringPanel } from '@/components/RecurringPanel';
import { CONTROLE, PageHeader, Tabs } from '@/components/ui/primitives';
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

  return (
    <section className="space-y-5">
      <PageHeader title={t('planning.titre')} description={t('planning.description')} />

      <Tabs
        value={onglet}
        onChange={setOnglet}
        options={[
          { value: 'calendrier', label: t('planning.titre') },
          { value: 'recurrence', label: t('recurrence.titre') },
        ]}
      />

      {onglet === 'recurrence' && <RecurringPanel />}

      {onglet === 'calendrier' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={vue}
              onChange={setVue}
              options={[
                { value: 'jour', label: t('planning.vues.jour') },
                { value: 'semaine', label: t('planning.vues.semaine') },
                { value: 'mois', label: t('planning.vues.mois') },
              ]}
            />

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setAncre((precedent) => minuit(precedent, -DUREE[vue]));
                }}
                className="rounded-lg border border-line px-2 py-1 text-xs transition hover:bg-sunken"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => {
                  setAncre(minuit(new Date()));
                }}
                className="rounded-lg border border-line px-2 py-1 text-xs transition hover:bg-sunken"
              >
                {jourLong.format(ancre)}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAncre((precedent) => minuit(precedent, DUREE[vue]));
                }}
                className="rounded-lg border border-line px-2 py-1 text-xs transition hover:bg-sunken"
              >
                →
              </button>
            </div>

            <select
              value={technicien}
              onChange={(event) => {
                setTechnicien(event.target.value);
              }}
              className={CONTROLE}
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
              className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs transition hover:bg-sunken"
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
              className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:bg-sunken disabled:opacity-50"
            >
              {t('planning.ajouterIndisponibilite')}
            </button>
          </div>

          {ouvertAbsence && (
            <form
              onSubmit={soumettreAbsence}
              className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-3 shadow-card"
            >
              <label className="space-y-0.5">
                <span className="block text-xs uppercase tracking-wide text-muted">
                  {t('planning.debut')}
                </span>
                <input
                  type="datetime-local"
                  value={absence.beginAt}
                  onChange={(event) => {
                    setAbsence((precedent) => ({ ...precedent, beginAt: event.target.value }));
                  }}
                  className={CONTROLE}
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-xs uppercase tracking-wide text-muted">
                  {t('planning.fin')}
                </span>
                <input
                  type="datetime-local"
                  value={absence.endAt}
                  onChange={(event) => {
                    setAbsence((precedent) => ({ ...precedent, endAt: event.target.value }));
                  }}
                  className={CONTROLE}
                />
              </label>
              <label className="flex-1 space-y-0.5">
                <span className="block text-xs uppercase tracking-wide text-muted">
                  {t('planning.motif')}
                </span>
                <input
                  value={absence.reason}
                  onChange={(event) => {
                    setAbsence((precedent) => ({ ...precedent, reason: event.target.value }));
                  }}
                  className={`${CONTROLE} w-full`}
                />
              </label>
              <button
                type="submit"
                disabled={declarer.isPending}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover disabled:opacity-50"
              >
                {t('planning.enregistrer')}
              </button>
              {declarer.error && (
                <p className="w-full text-xs text-critical">
                  {declarer.error.message}
                </p>
              )}
            </form>
          )}

          {conflits > 0 && (
            <p className="rounded-md border border-caution/30 bg-caution-soft p-2 text-sm text-caution-ink">
              {conflits} {t('planning.conflits')}
            </p>
          )}

          {planning.error instanceof ApiError && (
            <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
              {planning.error.message}
            </p>
          )}

          {planning.isPending && (
            <p className="text-sm text-muted">{t('commun.chargement')}</p>
          )}

          {planning.data && entrees.length === 0 && (
            <p className="text-sm text-muted">{t('planning.aucune')}</p>
          )}

          <div className="space-y-4">
            {parJour.map(([cle, liste]) => (
              <div key={cle} className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
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
                            ? 'border-caution/30 bg-caution-soft'
                            : 'border-line'
                        }`}
                      >
                        <span className="tabular-nums text-muted">
                          {heures.format(new Date(entree.beginAt))} –{' '}
                          {heures.format(new Date(entree.endAt))}
                        </span>

                        {entree.kind === 'unavailability' && (
                          <span className="rounded bg-sunken px-1.5 py-0.5 text-xs">
                            {t('planning.indisponibilite')}
                          </span>
                        )}

                        <span className="font-medium">{entree.title}</span>

                        {lien && (
                          <Link
                            to={lien}
                            className="text-xs text-muted underline-offset-2 hover:underline"
                          >
                            #{entree.itilId}
                          </Link>
                        )}

                        <span className="text-xs text-muted">{entree.userName ?? '—'}</span>

                        {entree.conflicts.length > 0 && (
                          <span className="rounded bg-caution-soft px-1.5 py-0.5 text-xs font-medium text-caution-ink">
                            {t('planning.conflit')}
                          </span>
                        )}

                        {entree.kind === 'unavailability' && (
                          <button
                            type="button"
                            onClick={() => {
                              retirer.mutate(entree.id);
                            }}
                            className="ml-auto text-xs text-muted underline-offset-2 hover:underline"
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
