import type { ItilStatus, TicketType } from '@tick/contracts';
import { useTranslation } from 'react-i18next';

/**
 * Codes couleur des statuts.
 *
 * Les quatre statuts ouverts se distinguent entre eux, les deux fermés
 * s'effacent : dans une liste de travail, l'œil doit trouver ce qui reste à
 * faire, pas ce qui est fini.
 */
const STATUS_STYLES: Record<ItilStatus, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  assigned: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  planned: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
  waiting: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  solved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  closed: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
};

export function StatusBadge({ status }: { status: ItilStatus }) {
  const { t } = useTranslation();

  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {t(`tickets.statuts.${status}`)}
    </span>
  );
}

/**
 * Priorité, sur une échelle de 1 à 5.
 *
 * Rendue par une barre plutôt que par un nombre seul : la comparaison entre
 * lignes se fait alors d'un coup d'œil, sans lire cinq libellés.
 */
export function PriorityBadge({ value }: { value: number }) {
  const { t } = useTranslation();
  const teinte =
    value >= 5
      ? 'bg-red-500'
      : value === 4
        ? 'bg-orange-500'
        : value === 3
          ? 'bg-amber-400'
          : value === 2
            ? 'bg-sky-400'
            : 'bg-neutral-300 dark:bg-neutral-600';

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={t(`tickets.priorites.p${String(value)}` as 'tickets.priorites.p1')}
    >
      <span className="flex h-3 w-8 gap-px overflow-hidden rounded-sm" aria-hidden>
        {[1, 2, 3, 4, 5].map((niveau) => (
          <span
            key={niveau}
            className={`flex-1 ${niveau <= value ? teinte : 'bg-neutral-200 dark:bg-neutral-800'}`}
          />
        ))}
      </span>
      <span className="sr-only">
        {t(`tickets.priorites.p${String(value)}` as 'tickets.priorites.p1')}
      </span>
    </span>
  );
}

export function TypeBadge({ type }: { type: TicketType }) {
  const { t } = useTranslation();

  return (
    <span className="text-xs text-neutral-500 dark:text-neutral-400">
      {t(`tickets.types.${type}`)}
    </span>
  );
}
