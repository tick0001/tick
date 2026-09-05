import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';

export function EntitiesPage() {
  const { t } = useTranslation();
  const entites = useQuery({ queryKey: ['entities'], queryFn: api.entities, retry: false });

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('entites.titre')}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('entites.description')}</p>
      </header>

      {entites.isPending && <p className="text-sm text-neutral-500">{t('commun.chargement')}</p>}

      {/* Un refus de droit n'est pas une panne : le dire clairement évite de
          faire chercher une erreur là où il n'y en a pas. */}
      {entites.error instanceof ApiError && entites.error.status === 403 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t('entites.interdit')}
        </p>
      )}

      {entites.error && !(entites.error instanceof ApiError && entites.error.status === 403) && (
        <p className="text-sm text-red-600 dark:text-red-400">{entites.error.message}</p>
      )}

      {entites.data && !entites.error && entites.data.length === 0 && (
        <p className="text-sm text-neutral-500">{t('entites.aucune')}</p>
      )}

      {entites.data && !entites.error && entites.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
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
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="px-4 py-2">
                    {/* L'indentation rend la profondeur lisible sans construire
                        un arbre : les entités arrivent déjà triées par chemin. */}
                    <span style={{ paddingLeft: `${String(entite.level * 16)}px` }}>
                      {entite.name}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-500">{entite.path}</td>
                  <td className="px-4 py-2 tabular-nums text-neutral-500">{entite.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
