import type { ItilStatus, TicketType } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Codes couleur des statuts.
 *
 * Les quatre statuts ouverts se distinguent entre eux, les deux fermés
 * s'effacent : dans une liste de travail, l'œil doit trouver ce qui reste à
 * faire, pas ce qui est fini. Une pastille précède le libellé — elle porte la
 * couleur, ce qui laisse le fond de l'étiquette léger et garde une liste de
 * quarante lignes lisible.
 */
const STATUTS: Record<ItilStatus, { fond: string; pastille: string }> = {
  new: { fond: 'bg-info-soft text-info-ink', pastille: 'bg-info' },
  assigned: { fond: 'bg-brand-soft text-brand-ink', pastille: 'bg-brand' },
  planned: { fond: 'bg-brand-soft text-brand-ink', pastille: 'bg-brand/50' },
  waiting: { fond: 'bg-caution-soft text-caution-ink', pastille: 'bg-caution' },
  solved: { fond: 'bg-positive-soft text-positive-ink', pastille: 'bg-positive' },
  closed: { fond: 'bg-sunken text-faint', pastille: 'bg-line-strong' },
};

export function StatusBadge({ status }: { status: ItilStatus }) {
  const { t } = useTranslation();
  const style = STATUTS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        style.fond,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', style.pastille)} aria-hidden />
      {t(`tickets.statuts.${status}`)}
    </span>
  );
}

/**
 * Priorité, sur une échelle de 1 à 5.
 *
 * Rendue par une jauge segmentée plutôt que par un nombre : la comparaison
 * entre lignes se fait alors d'un coup d'œil, sans lire cinq libellés. Les
 * segments éteints restent visibles — sans eux, on ne saurait pas sur quelle
 * échelle se lit le remplissage.
 */
export function PriorityBadge({ value }: { value: number }) {
  const { t } = useTranslation();
  const teinte =
    value >= 5
      ? 'bg-critical'
      : value === 4
        ? 'bg-caution'
        : value === 3
          ? 'bg-caution/60'
          : value === 2
            ? 'bg-info/70'
            : 'bg-line-strong';

  const libelle = t(`tickets.priorites.p${String(value)}` as 'tickets.priorites.p1');

  return (
    <span className="inline-flex items-center gap-1.5" title={libelle}>
      <span className="flex h-1.5 w-10 gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((niveau) => (
          <span
            key={niveau}
            className={cn('flex-1 rounded-full', niveau <= value ? teinte : 'bg-sunken')}
          />
        ))}
      </span>
      <span className="sr-only">{libelle}</span>
    </span>
  );
}

/**
 * Incident ou demande.
 *
 * Un texte teinté, pas une étiquette pleine : la distinction est utile mais
 * secondaire, et une pastille colorée sur chaque ligne d'une liste de quarante
 * entrerait en concurrence avec le statut, qui lui doit sauter aux yeux.
 */
export function TypeBadge({ type }: { type: TicketType }) {
  const { t } = useTranslation();

  return (
    <span className={cn('font-medium', type === 'incident' ? 'text-critical' : 'text-muted')}>
      {t(`tickets.types.${type}`)}
    </span>
  );
}
