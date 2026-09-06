import { useQuery } from '@tanstack/react-query';
import type { TicketAgreement } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';

/**
 * Durée lisible, arrondie à l'unité qui parle.
 *
 * « 3 h » plutôt que « 2 h 58 min » : à l'échelle d'un engagement, la minute
 * n'aide personne à décider quoi traiter en premier.
 */
function duree(secondes: number): string {
  const absolu = Math.abs(secondes);

  if (absolu < 3600) return `${String(Math.round(absolu / 60))} min`;
  if (absolu < 86_400) return `${String(Math.round(absolu / 3600))} h`;

  return `${String(Math.round(absolu / 86_400))} j`;
}

/**
 * État des engagements d'un ticket.
 *
 * Chargé séparément de la fiche : le temps restant se périme à la seconde, et
 * l'attacher au ticket obligerait à recalculer quatre échéances à chaque
 * lecture, y compris dans les vues qui ne l'affichent pas.
 */
export function AgreementBadges({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation();
  const engagements = useQuery({
    queryKey: ['ticket-agreements', ticketId],
    queryFn: () => api.ticketAgreements(ticketId),
    retry: false,
  });

  if (!engagements.data || engagements.data.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {engagements.data.map((engagement: TicketAgreement) => (
        <span
          key={`${engagement.kind}-${engagement.axis}`}
          title={`${engagement.name} — ${new Date(engagement.dueAt).toLocaleString()}`}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
            engagement.isBreached
              ? 'border-critical/30 bg-critical-soft text-critical-ink'
              : 'border-line bg-surface text-muted'
          }`}
        >
          <span className="font-semibold tracking-wide uppercase">{engagement.kind}</span>
          <span>{t(`engagements.axes.${engagement.axis}`)}</span>
          <span className="tabular-nums">
            {engagement.isBreached
              ? `${t('engagements.depassee')} · ${duree(engagement.remainingSeconds)}`
              : duree(engagement.remainingSeconds)}
          </span>
        </span>
      ))}
    </div>
  );
}
