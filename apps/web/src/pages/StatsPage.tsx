import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { statDimensionSchema, type StatDimension, type UpsertDashboardWidget } from '@tick/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Compteurs, Repartition, Tendance, WidgetView } from '@/components/StatsWidgets';
import { ApiError, api } from '@/lib/api';

/** Bornes par défaut : les trente derniers jours, ce que la courbe couvre. */
function fenetreParDefaut(): { from: string; to: string } {
  const fin = new Date();
  const debut = new Date(fin.getTime() - 30 * 86_400_000);

  return { from: debut.toISOString().slice(0, 10), to: fin.toISOString().slice(0, 10) };
}

/**
 * Statistiques et tableaux de bord.
 *
 * Deux onglets sur une même page parce qu'ils lisent les mêmes chiffres : le
 * premier les explore librement, le second fige une composition qu'on veut
 * retrouver telle quelle. Les séparer en deux écrans aurait obligé à choisir
 * avant de savoir ce qu'on cherche.
 */
export function StatsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [onglet, setOnglet] = useState<'indicateurs' | 'tableaux'>('indicateurs');
  const [bornes, setBornes] = useState(fenetreParDefaut);
  const [dimension, setDimension] = useState<StatDimension>('status');

  const filtre = useMemo(
    () => ({
      dimension,
      ...(bornes.from ? { from: new Date(`${bornes.from}T00:00:00`).toISOString() } : {}),
      ...(bornes.to ? { to: new Date(`${bornes.to}T23:59:59`).toISOString() } : {}),
    }),
    [bornes, dimension],
  );

  const rapport = useQuery({
    queryKey: ['stats', filtre],
    queryFn: () => api.stats(filtre),
    retry: false,
  });

  const tendance = useQuery({
    queryKey: ['stats-trend', filtre],
    queryFn: () => api.statsTrend(filtre),
    retry: false,
  });

  const tableaux = useQuery({ queryKey: ['dashboards'], queryFn: api.dashboards, retry: false });
  const catalogue = useQuery({
    queryKey: ['widgets'],
    queryFn: api.widgetCatalog,
    retry: false,
  });

  const [nouveau, setNouveau] = useState('');

  const creer = useMutation({
    mutationFn: (widgets: UpsertDashboardWidget[]) =>
      api.saveDashboard({ name: nouveau, isPublic: false, isRecursive: false, widgets }),
    onSuccess: async () => {
      setNouveau('');
      await queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteDashboard(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const controle =
    'rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950';

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('statistiques.titre')}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t('statistiques.description')}
        </p>
      </header>

      <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
        {(['indicateurs', 'tableaux'] as const).map((valeur) => (
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
            {valeur === 'indicateurs' ? t('statistiques.titre') : t('tableaux.titre')}
          </button>
        ))}
      </div>

      {onglet === 'indicateurs' && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-neutral-500">
                {t('statistiques.du')}
              </span>
              <input
                type="date"
                value={bornes.from}
                onChange={(event) => {
                  setBornes((precedent) => ({ ...precedent, from: event.target.value }));
                }}
                className={controle}
              />
            </label>
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-neutral-500">
                {t('statistiques.au')}
              </span>
              <input
                type="date"
                value={bornes.to}
                onChange={(event) => {
                  setBornes((precedent) => ({ ...precedent, to: event.target.value }));
                }}
                className={controle}
              />
            </label>
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-neutral-500">
                {t('statistiques.repartition')}
              </span>
              <select
                value={dimension}
                onChange={(event) => {
                  setDimension(statDimensionSchema.parse(event.target.value));
                }}
                className={controle}
              >
                {statDimensionSchema.options.map((valeur) => (
                  <option key={valeur} value={valeur}>
                    {t(`statistiques.dimensions.${valeur}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {rapport.error instanceof ApiError && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {rapport.error.status === 403 ? t('tickets.interdit') : rapport.error.message}
            </p>
          )}

          {rapport.isPending && <p className="text-sm text-neutral-500">{t('commun.chargement')}</p>}

          {rapport.data && (
            <>
              <Compteurs rapport={rapport.data} />

              <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <h3 className="text-sm font-semibold">{t('statistiques.tendance')}</h3>
                <Tendance points={tendance.data ?? []} />
              </section>

              <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <h3 className="text-sm font-semibold">
                  {t('statistiques.repartition')} {t(`statistiques.dimensions.${dimension}`)}
                </h3>
                <Repartition seaux={rapport.data.buckets} />
              </section>
            </>
          )}
        </>
      )}

      {onglet === 'tableaux' && (
        <div className="space-y-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (nouveau.trim()) {
                creer.mutate([
                  { kind: 'core.counts', title: '', width: 12, config: {} },
                  { kind: 'core.trend', title: '', width: 12, config: {} },
                ]);
              }
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-neutral-500">
                {t('tableaux.nom')}
              </span>
              <input
                value={nouveau}
                onChange={(event) => {
                  setNouveau(event.target.value);
                }}
                className={`${controle} w-64`}
              />
            </label>
            <button
              type="submit"
              disabled={creer.isPending || nouveau.trim().length === 0}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('tableaux.nouveau')}
            </button>
          </form>

          {creer.error && (
            <p className="text-xs text-red-600 dark:text-red-400">{creer.error.message}</p>
          )}

          {tableaux.data && tableaux.data.length === 0 && (
            <p className="text-sm text-neutral-500">{t('tableaux.aucun')}</p>
          )}

          {(tableaux.data ?? []).map((tableau) => (
            <section
              key={tableau.id}
              className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{tableau.name}</h3>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                  {tableau.isPublic ? t('tableaux.public') : t('tableaux.personnel')}
                </span>
                <span className="text-xs text-neutral-500">{tableau.entityName}</span>

                {tableau.isMine && (
                  <button
                    type="button"
                    onClick={() => {
                      supprimer.mutate(tableau.id);
                    }}
                    className="ml-auto text-xs text-neutral-500 underline-offset-2 hover:underline"
                  >
                    {t('tableaux.supprimer')}
                  </button>
                )}
              </header>

              <div className="grid grid-cols-12 gap-3">
                {tableau.widgets.map((widget) => {
                  const declaration = (catalogue.data ?? []).find(
                    (entree) => entree.kind === widget.kind,
                  );

                  return (
                    <div
                      key={widget.id}
                      style={{ gridColumn: `span ${String(widget.width)} / span ${String(widget.width)}` }}
                      className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
                    >
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {widget.title || declaration?.label || widget.kind}
                      </h4>
                      <WidgetView kind={widget.kind} config={widget.config} filtre={filtre} />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );

}
