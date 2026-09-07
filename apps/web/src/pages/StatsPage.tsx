import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  statDimensionSchema,
  type StatDimension,
  type UpsertDashboardWidget,
} from '@tick/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Compteurs, Repartition, Tendance, WidgetView } from '@/components/StatsWidgets';
import { CONTROLE, PageHeader, Tabs } from '@/components/ui/primitives';
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

  return (
    <section className="space-y-5">
      <PageHeader title={t('statistiques.titre')} description={t('statistiques.description')} />

      <Tabs
        value={onglet}
        onChange={setOnglet}
        options={[
          { value: 'indicateurs', label: t('statistiques.titre') },
          { value: 'tableaux', label: t('tableaux.titre') },
        ]}
      />

      {onglet === 'indicateurs' && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-muted">
                {t('statistiques.du')}
              </span>
              <input
                type="date"
                value={bornes.from}
                onChange={(event) => {
                  setBornes((precedent) => ({ ...precedent, from: event.target.value }));
                }}
                className={CONTROLE}
              />
            </label>
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-muted">
                {t('statistiques.au')}
              </span>
              <input
                type="date"
                value={bornes.to}
                onChange={(event) => {
                  setBornes((precedent) => ({ ...precedent, to: event.target.value }));
                }}
                className={CONTROLE}
              />
            </label>
            <label className="space-y-0.5">
              <span className="block text-xs uppercase tracking-wide text-muted">
                {t('statistiques.repartition')}
              </span>
              <select
                value={dimension}
                onChange={(event) => {
                  setDimension(statDimensionSchema.parse(event.target.value));
                }}
                className={CONTROLE}
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
            <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
              {rapport.error.status === 403 ? t('tickets.interdit') : rapport.error.message}
            </p>
          )}

          {rapport.isPending && <p className="text-sm text-muted">{t('commun.chargement')}</p>}

          {rapport.data && (
            <>
              <Compteurs rapport={rapport.data} />

              <section className="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
                <h3 className="text-sm font-semibold">{t('statistiques.tendance')}</h3>
                <Tendance points={tendance.data ?? []} />
              </section>

              <section className="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
                <h3 className="text-sm font-semibold">
                  {t('statistiques.repartition')} {t(`statistiques.dimensions.${dimension}`)}
                </h3>
                <Repartition seaux={rapport.data.buckets} dimension={dimension} />
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
              <span className="block text-xs uppercase tracking-wide text-muted">
                {t('tableaux.nom')}
              </span>
              <input
                value={nouveau}
                onChange={(event) => {
                  setNouveau(event.target.value);
                }}
                className={`${CONTROLE} w-64`}
              />
            </label>
            <button
              type="submit"
              disabled={creer.isPending || nouveau.trim().length === 0}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover disabled:opacity-50"
            >
              {t('tableaux.nouveau')}
            </button>
          </form>

          {creer.error && <p className="text-xs text-critical">{creer.error.message}</p>}

          {tableaux.data && tableaux.data.length === 0 && (
            <p className="text-sm text-muted">{t('tableaux.aucun')}</p>
          )}

          {(tableaux.data ?? []).map((tableau) => (
            <section
              key={tableau.id}
              className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card"
            >
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{tableau.name}</h3>
                <span className="rounded bg-sunken px-1.5 py-0.5 text-xs">
                  {tableau.isPublic ? t('tableaux.public') : t('tableaux.personnel')}
                </span>
                <span className="text-xs text-muted">{tableau.entityName}</span>

                {tableau.isMine && (
                  <button
                    type="button"
                    onClick={() => {
                      supprimer.mutate(tableau.id);
                    }}
                    className="ml-auto text-xs text-muted underline-offset-2 hover:underline"
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
                      style={{
                        gridColumn: `span ${String(widget.width)} / span ${String(widget.width)}`,
                      }}
                      className="space-y-2 rounded-card border border-line bg-surface p-3 shadow-card"
                    >
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
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
