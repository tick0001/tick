import type { TimelineEntry } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** Teinte de la pastille de chronologie, par nature d'entrée. */
const NATURES: Record<string, string> = {
  followup: 'bg-brand',
  task: 'bg-info',
  solution: 'bg-positive',
  validation: 'bg-caution',
};

/**
 * Une entrée de chronologie.
 *
 * Toutes les entrées pendent au même filet vertical, marquées d'une pastille :
 * l'ordre se lit alors sans compter les cartes. L'historique reste en retrait et
 * en gris — il documente, il ne se lit pas au même rythme qu'un suivi rédigé par
 * un humain.
 */
function Entree({ entree, locale }: { entree: TimelineEntry; locale: string }) {
  const { t } = useTranslation();
  const horodatage = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(entree.at));

  if (entree.kind === 'log') {
    return (
      <li className="relative pl-6">
        <span className="absolute top-2 left-[0.3125rem] size-1.5 rounded-full bg-line-strong" />
        <div className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-xs text-faint">
          <span className="tabular-nums">{horodatage}</span>
          <span className="font-medium text-muted">{entree.field}</span>
          {entree.oldValue !== null && (
            <span>
              <span className="line-through">{entree.oldValue}</span> → {entree.newValue ?? '—'}
            </span>
          )}
          {entree.oldValue === null && entree.newValue !== null && <span>{entree.newValue}</span>}
          {entree.author && <span>· {entree.author.name}</span>}
        </div>
      </li>
    );
  }

  return (
    <li className="relative pl-6">
      <span
        className={cn(
          'absolute top-3 left-1 size-2.5 rounded-full ring-4 ring-canvas',
          NATURES[entree.kind] ?? 'bg-line-strong',
        )}
      />
      <div className="rounded-card border border-line bg-surface p-3 shadow-card">
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2 text-xs">
          <span className="font-semibold text-ink">{t(`tickets.chronologie.${entree.kind}`)}</span>
          <span className="tabular-nums text-faint">{horodatage}</span>
          {entree.author && <span className="text-muted">· {entree.author.name}</span>}
          {'isPrivate' in entree && entree.isPrivate && (
            <span className="rounded-md bg-caution-soft px-1.5 py-0.5 font-medium text-caution-ink">
              {t('tickets.detail.prive')}
            </span>
          )}
        </div>

        {'content' in entree && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{entree.content}</p>
        )}

        {entree.kind === 'validation' && (
          <p className="text-sm">
            {entree.validator?.name ?? '—'} · {entree.status}
            {entree.responseComment && ` — ${entree.responseComment}`}
          </p>
        )}
      </div>
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
    return <EmptyState title={t('tickets.detail.aucuneEntree')} />;
  }

  return (
    <ul className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[0.5625rem] before:w-px before:bg-line">
      {(entrees ?? []).map((entree) => (
        <Entree key={`${entree.kind}-${String(entree.id)}`} entree={entree} locale={locale} />
      ))}
    </ul>
  );
}
