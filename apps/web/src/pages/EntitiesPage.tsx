import { useQuery } from '@tanstack/react-query';
import type { SessionContext } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { PluginSlot } from '@/components/PluginSlot';
import { ApiError, api } from '@/lib/api';

export function EntitiesPage({ session }: { session: SessionContext }) {
  const { t, i18n } = useTranslation();
  const entites = useQuery({ queryKey: ['entities'], queryFn: api.entities, retry: false });

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t('entites.titre')}</h2>
          <p className="text-sm text-muted">
            {t('entites.description')}
          </p>
        </div>

        <PluginSlot
          name="entity.list.actions"
          className="flex items-center gap-2"
          context={{
            locale: i18n.language,
            entity: session.entity,
            profile: session.profile,
          }}
        />
      </header>

      {entites.isPending && <p className="text-sm text-muted">{t('commun.chargement')}</p>}

      {/* Un refus de droit n'est pas une panne : le dire clairement évite de
          faire chercher une erreur là où il n'y en a pas. */}
      {entites.error instanceof ApiError && entites.error.status === 403 && (
        <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
          {t('entites.interdit')}
        </p>
      )}

      {entites.error && !(entites.error instanceof ApiError && entites.error.status === 403) && (
        <p className="text-sm text-critical">{entites.error.message}</p>
      )}

      {entites.data && !entites.error && entites.data.length === 0 && (
        <p className="text-sm text-muted">{t('entites.aucune')}</p>
      )}

      {entites.data && !entites.error && entites.data.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sunken bg-surface">
              <tr>
                <th className="px-4 py-2 font-medium">{t('entites.nom')}</th>
                <th className="px-4 py-2 font-medium">{t('entites.chemin')}</th>
                <th className="px-4 py-2 font-medium">{t('entites.niveau')}</th>
              </tr>
            </thead>
            <tbody>
              {entites.data.map((entite) => (
                <tr
                  key={entite.id}
                  className="border-b border-line last:border-0"
                >
                  <td className="px-4 py-2">
                    {/* L'indentation rend la profondeur lisible sans construire
                        un arbre : les entités arrivent déjà triées par chemin. */}
                    <span style={{ paddingLeft: `${String(entite.level * 16)}px` }}>
                      {entite.name}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{entite.path}</td>
                  <td className="px-4 py-2 tabular-nums text-muted">{entite.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
