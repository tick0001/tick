import type { ItilStatus, TicketType } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Codes couleur des statuts.
 *
 * Un carré plein précède le libellé, et le libellé reste en encre : c'est le
 * carré qui porte l'état, pas un aplat de couleur derrière le texte. La pastille
 * pastel — celle que produisent toutes les bibliothèques — teinte la moitié de
 * la ligne et fait perdre au tableau sa tenue dès qu'on en affiche quarante.
 *
 * Les quatre statuts ouverts se distinguent entre eux ; les deux fermés
 * s'effacent, carré évidé et texte pâle. Dans une liste de travail, l'œil doit
 * trouver ce qui reste à faire, pas ce qui est fini.
 */
const STATUTS: Record<ItilStatus, { texte: string; carre: string }> = {
  new: { texte: 'text-ink', carre: 'bg-info' },
  assigned: { texte: 'text-ink', carre: 'bg-brand' },
  planned: { texte: 'text-ink', carre: 'bg-brand/45' },
  waiting: { texte: 'text-ink', carre: 'bg-caution' },
  solved: { texte: 'text-muted', carre: 'bg-positive' },
  closed: { texte: 'text-faint', carre: 'border border-line-strong bg-transparent' },
};

export function StatusBadge({ status }: { status: ItilStatus }) {
  const { t } = useTranslation();
  const style = STATUTS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
        style.texte,
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-[1px]', style.carre)} aria-hidden />
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
      ? 'bg-brand'
      : value === 4
        ? 'bg-caution'
        : value === 3
          ? 'bg-caution/55'
          : value === 2
            ? 'bg-info/60'
            : 'bg-line-strong';

  const libelle = t(`tickets.priorites.p${String(value)}` as 'tickets.priorites.p1');

  return (
    <span className="inline-flex items-center gap-1.5" title={libelle}>
      {/* Des barres droites et jointives : une echelle graduee, pas cinq points.
          La comparaison entre deux lignes se fait alors sans lire les libelles. */}
      <span className="flex h-2.5 w-10 gap-px" aria-hidden>
        {[1, 2, 3, 4, 5].map((niveau) => (
          <span
            key={niveau}
            className={cn('flex-1 rounded-[1px]', niveau <= value ? teinte : 'bg-sunken')}
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
