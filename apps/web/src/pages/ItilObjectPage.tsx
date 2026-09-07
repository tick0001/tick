import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItilKind } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Attachments } from '@/components/Attachments';
import { LinksPanel } from '@/components/LinksPanel';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadges';
import { Timeline } from '@/components/Timeline';
import { ApiError, api } from '@/lib/api';

/**
 * Champs propres à chaque type, dans l'ordre où ils se lisent.
 *
 * Les clés sont énumérées plutôt que dérivées de `keyof ItilObject` : la clé de
 * traduction se construit à partir d'elles, et une union élargie ferait
 * réclamer au compilateur des libellés pour `id` et `status`.
 */
type ChampExtra =
  'symptoms' | 'causes' | 'impacts' | 'deploymentPlan' | 'rollbackPlan' | 'validationPlan';

const CHAMPS: Record<ItilKind, readonly ChampExtra[]> = {
  problem: ['symptoms', 'causes', 'impacts'],
  change: ['deploymentPlan', 'rollbackPlan', 'validationPlan'],
};

function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted">{libelle}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Fiche d'un problème ou d'un changement.
 *
 * La chronologie, les pièces jointes et les liens sont exactement ceux du
 * ticket : ce sont les satellites du socle commun, et leur donner ici une autre
 * apparence ferait croire à un autre mécanisme.
 */
export function ItilObjectPage({ kind }: { kind: ItilKind }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const params = useParams();
  const id = Number(params['id']);

  const [suivi, setSuivi] = useState('');
  const [prive, setPrive] = useState(false);

  const objet = useQuery({
    queryKey: ['itil-object', kind, id],
    queryFn: () => api.itilObject(kind, id),
    retry: false,
  });

  const timeline = useQuery({
    queryKey: ['itil-timeline', kind, id],
    queryFn: () => api.itilTimeline(kind, id),
    retry: false,
  });

  const publier = useMutation({
    mutationFn: () =>
      api.addItilFollowup(kind, id, { content: suivi, isPrivate: prive, source: 'interface' }),
    onSuccess: async () => {
      setSuivi('');
      await queryClient.invalidateQueries({ queryKey: ['itil-timeline', kind, id] });
      await queryClient.invalidateQueries({ queryKey: ['itil-object', kind, id] });
    },
  });

  if (objet.error instanceof ApiError) {
    return (
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
        {objet.error.status === 403 ? t('tickets.interdit') : objet.error.message}
      </p>
    );
  }

  if (!objet.data) return <p className="text-sm text-muted">{t('commun.chargement')}</p>;

  const detail = objet.data;
  const section = kind === 'problem' ? 'problemes' : 'changements';
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (suivi.trim().length > 0) publier.mutate();
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`/itil/${kind === 'problem' ? 'problems' : 'changes'}`}
          className="text-xs text-muted underline-offset-2 hover:underline"
        >
          ← {t(`itil.${section}.titre`)}
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums text-muted">#{detail.id}</span>
          <StatusBadge status={detail.status} />
          <PriorityBadge value={detail.priority} />
          <span className="rounded bg-sunken px-1.5 py-0.5 text-xs">
            {t(`itil.objets.${kind}`)}
          </span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{detail.name}</h2>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <article className="whitespace-pre-wrap rounded-card border border-line bg-surface p-4 shadow-card text-sm">
            {detail.content || '—'}
          </article>

          {CHAMPS[kind].map((champ) => (
            <section
              key={champ}
              className="space-y-1 rounded-card border border-line bg-surface p-4 shadow-card"
            >
              <h3 className="text-sm font-semibold">{t(`itil.champs.${champ}`)}</h3>
              <p className="whitespace-pre-wrap text-sm text-muted">{detail[champ] || '—'}</p>
            </section>
          ))}

          {kind === 'change' && detail.checklist.length > 0 && (
            <section className="space-y-1 rounded-card border border-line bg-surface p-4 shadow-card">
              <h3 className="text-sm font-semibold">{t('itil.champs.checklist')}</h3>
              <ul className="space-y-1 text-sm">
                {detail.checklist.map((ligne) => (
                  <li key={ligne.label} className="flex items-center gap-2">
                    <input type="checkbox" checked={ligne.done} readOnly />
                    <span className={ligne.done ? 'text-faint line-through' : ''}>
                      {ligne.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Attachments itemType={kind} itemId={id} />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('tickets.detail.chronologie')}</h3>
            <Timeline entrees={timeline.data} locale={i18n.language} />
          </section>

          <form
            onSubmit={soumettre}
            className="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card"
          >
            <h3 className="text-sm font-semibold">{t('tickets.detail.ajouterSuivi')}</h3>
            <textarea
              value={suivi}
              onChange={(event) => {
                setSuivi(event.target.value);
              }}
              rows={3}
              placeholder={t('tickets.detail.suiviPlaceholder')}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={prive}
                  onChange={(event) => {
                    setPrive(event.target.checked);
                  }}
                />
                {t('tickets.detail.suiviPrive')}
              </label>
              <button
                type="submit"
                disabled={publier.isPending || suivi.trim().length === 0}
                className="ml-auto rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover disabled:opacity-50"
              >
                {t('tickets.detail.envoyer')}
              </button>
            </div>
            {publier.error && <p className="text-xs text-critical">{publier.error.message}</p>}
          </form>
        </div>

        <aside className="space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <dl className="space-y-3">
            <Champ libelle={t('tickets.entite')}>{detail.entityName}</Champ>
            <Champ libelle={t('tickets.categorie')}>{detail.categoryName ?? '—'}</Champ>
            <Champ libelle={t('itil.formulaire.urgence')}>{detail.urgency} / 5</Champ>
            <Champ libelle={t('itil.formulaire.impact')}>{detail.impact} / 5</Champ>
            <Champ libelle={t('tickets.detail.lieu')}>{detail.locationName ?? '—'}</Champ>
            <Champ libelle={t('tickets.ouvertLe')}>
              {dates.format(new Date(detail.dateOpened))}
            </Champ>
            {detail.dateSolved && (
              <Champ libelle={t('tickets.detail.resolu')}>
                {dates.format(new Date(detail.dateSolved))}
              </Champ>
            )}
            <Champ libelle={t('tickets.detail.tempsInterne')}>
              {detail.internalTime} {t('tickets.detail.minutes')}
            </Champ>
          </dl>

          <div className="space-y-1">
            <h3 className="text-xs uppercase tracking-wide text-muted">
              {t('tickets.detail.acteurs')}
            </h3>
            <ul className="space-y-1 text-sm">
              <li>
                <span className="text-muted">{t('tickets.roles.requester')} : </span>
                {detail.requesters.join(', ') || '—'}
              </li>
              <li>
                <span className="text-muted">{t('tickets.roles.assigned')} : </span>
                {detail.assignees.join(', ') || '—'}
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <LinksPanel type={kind} id={id} />
    </div>
  );
}
