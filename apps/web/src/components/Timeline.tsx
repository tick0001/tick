import type { TimelineEntry } from '@tick/contracts';
import { useTranslation } from 'react-i18next';

/**
 * Une entrée de chronologie.
 *
 * L'historique est rendu en retrait et en gris : il documente, il ne se lit pas
 * au même rythme qu'un suivi rédigé par un humain.
 */
function Entree({ entree, locale }: { entree: TimelineEntry; locale: string }) {
  const { t } = useTranslation();
  const horodatage = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(entree.at));

  if (entree.kind === 'log') {
    return (
      <li className="flex flex-wrap items-baseline gap-x-2 py-1 text-xs text-neutral-500">
        <span className="tabular-nums">{horodatage}</span>
        <span className="font-medium">{entree.field}</span>
        {entree.oldValue !== null && (
          <span>
            <span className="line-through">{entree.oldValue}</span> → {entree.newValue ?? '—'}
          </span>
        )}
        {entree.oldValue === null && entree.newValue !== null && <span>{entree.newValue}</span>}
        {entree.author && <span className="text-neutral-400">· {entree.author.name}</span>}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs text-neutral-500">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          {t(`tickets.chronologie.${entree.kind}`)}
        </span>
        <span className="tabular-nums">{horodatage}</span>
        {entree.author && <span>· {entree.author.name}</span>}
        {'isPrivate' in entree && entree.isPrivate && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t('tickets.detail.prive')}
          </span>
        )}
      </div>

      {'content' in entree && <p className="whitespace-pre-wrap text-sm">{entree.content}</p>}

      {entree.kind === 'validation' && (
        <p className="text-sm">
          {entree.validator?.name ?? '—'} · {entree.status}
          {entree.responseComment && ` — ${entree.responseComment}`}
        </p>
      )}
    </li>
  );
}

/**
 * Chronologie d'un objet ITIL.
 *
 * Le même composant pour le ticket, le problème et le changement : les
 * satellites sont polymorphes en base, et les rendre différemment selon le
 * porteur reviendrait à nier ce que le modèle a déjà unifié.
 */
export function Timeline({
  entrees,
  locale,
}: {
  entrees: readonly TimelineEntry[] | undefined;
  locale: string;
}) {
  const { t } = useTranslation();

  if (entrees && entrees.length === 0) {
    return <p className="text-sm text-neutral-500">{t('tickets.detail.aucuneEntree')}</p>;
  }

  return (
    <ul className="space-y-2">
      {(entrees ?? []).map((entree) => (
        <Entree key={`${entree.kind}-${String(entree.id)}`} entree={entree} locale={locale} />
      ))}
    </ul>
  );
}
