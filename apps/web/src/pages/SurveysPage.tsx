import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionContext, UpsertSatisfactionConfig } from '@tick/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { BOUTON } from '@/components/ui/primitives';

const champ =
  'w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm';
const carte = 'rounded-card border border-line bg-surface p-4 shadow-card';

const DEFAUT: UpsertSatisfactionConfig = {
  isRecursive: true,
  isActive: false,
  percentage: 30,
  delayDays: 1,
  durationDays: 30,
  reminderDays: null,
};

/**
 * Paramétrage des enquêtes et exploitation des réponses.
 *
 * La configuration porte sur l'entité active ; les statistiques, elles, portent
 * sur tout le périmètre de travail. Les deux au même endroit parce qu'un taux
 * ne se règle qu'en regardant ce qu'il a produit.
 */
export function SurveysPage({ session }: { session: SessionContext }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [valeurs, setValeurs] = useState<UpsertSatisfactionConfig>(DEFAUT);
  const [erreur, setErreur] = useState<string | null>(null);

  const configs = useQuery({
    queryKey: ['satisfaction-configs'],
    queryFn: api.satisfactionConfigs,
    retry: false,
  });

  const stats = useQuery({
    queryKey: ['satisfaction-stats'],
    queryFn: api.satisfactionStats,
    retry: false,
  });

  // La configuration affichée est celle de l'entité active : changer de contexte
  // doit recharger le formulaire, sinon on modifierait la mauvaise entité.
  const propre = configs.data?.find((config) => config.entityId === session.entity.id);

  useEffect(() => {
    setValeurs(
      propre
        ? {
            isRecursive: propre.isRecursive,
            isActive: propre.isActive,
            percentage: propre.percentage,
            delayDays: propre.delayDays,
            durationDays: propre.durationDays,
            reminderDays: propre.reminderDays,
          }
        : DEFAUT,
    );
  }, [propre]);

  const enregistrer = useMutation({
    mutationFn: () => api.saveSatisfactionConfig(valeurs),
    onSuccess: async () => {
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['satisfaction-configs'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  if (configs.error instanceof ApiError && configs.error.status === 403) {
    return (
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
        {t('entites.interdit')}
      </p>
    );
  }

  const maj = (patch: Partial<UpsertSatisfactionConfig>): void => {
    setValeurs({ ...valeurs, ...patch });
  };

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('enquetes.titre')}</h2>
        <p className="text-sm text-muted">
          {t('enquetes.description', { entite: session.entity.name })}
        </p>
      </header>

      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      <form
        className={`${carte} space-y-3`}
        onSubmit={(event) => {
          event.preventDefault();
          enregistrer.mutate();
        }}
      >
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs text-muted">{t('enquetes.taux')}</span>
            <input
              type="number"
              min={0}
              max={100}
              className={champ}
              value={valeurs.percentage}
              onChange={(event) => {
                maj({ percentage: Number(event.target.value) });
              }}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted">{t('enquetes.delai')}</span>
            <input
              type="number"
              min={0}
              className={champ}
              value={valeurs.delayDays}
              onChange={(event) => {
                maj({ delayDays: Number(event.target.value) });
              }}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted">{t('enquetes.duree')}</span>
            <input
              type="number"
              min={1}
              className={champ}
              value={valeurs.durationDays}
              onChange={(event) => {
                maj({ durationDays: Number(event.target.value) });
              }}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted">{t('enquetes.relance')}</span>
            <input
              type="number"
              min={1}
              className={champ}
              value={valeurs.reminderDays ?? ''}
              onChange={(event) => {
                maj({
                  reminderDays: event.target.value === '' ? null : Number(event.target.value),
                });
              }}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={valeurs.isActive}
              onChange={(event) => {
                maj({ isActive: event.target.checked });
              }}
            />
            <span>{t('notifications.actif')}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={valeurs.isRecursive}
              onChange={(event) => {
                maj({ isRecursive: event.target.checked });
              }}
            />
            <span>{t('commun.recursif')}</span>
          </label>
        </div>

        <button type="submit" className={BOUTON}>
          {t('commun.enregistrer')}
        </button>
      </form>

      {stats.data && (
        <div className={`${carte} space-y-3`}>
          <h3 className="text-sm font-semibold">{t('enquetes.resultats')}</h3>

          <div className="flex flex-wrap gap-6 text-sm">
            <p>
              <span className="text-muted">{t('enquetes.envoyees')} : </span>
              <span className="tabular-nums">{stats.data.requested}</span>
            </p>
            <p>
              <span className="text-muted">{t('enquetes.repondues')} : </span>
              <span className="tabular-nums">{stats.data.answered}</span>
            </p>
            <p>
              <span className="text-muted">{t('enquetes.moyenne')} : </span>
              <span className="tabular-nums">{stats.data.averageRating ?? '—'}</span>
            </p>
          </div>

          {stats.data.distribution.length > 0 && (
            <ul className="space-y-1 text-sm">
              {stats.data.distribution.map((ligne) => (
                <li key={ligne.rating} className="flex items-center gap-2">
                  <span className="w-4 tabular-nums">{ligne.rating}</span>
                  <span
                    className="inline-block h-2 rounded bg-brand"
                    style={{
                      width: `${String(
                        Math.max(
                          4,
                          Math.round((ligne.count / Math.max(1, stats.data.answered)) * 240),
                        ),
                      )}px`,
                    }}
                  />
                  <span className="tabular-nums text-muted">{ligne.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
