import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItilStatus, TimelineEntry } from '@tick/contracts';
import { itilStatusSchema } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { AgreementBadges } from '@/components/AgreementBadges';
import { Attachments } from '@/components/Attachments';
import { PriorityBadge, StatusBadge, TypeBadge } from '@/components/TicketBadges';
import { ApiError, api } from '@/lib/api';

function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{libelle}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

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

export function TicketPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const params = useParams();
  const id = Number(params['id']);

  const [suivi, setSuivi] = useState('');
  const [prive, setPrive] = useState(false);

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.ticket(id),
    retry: false,
  });
  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => api.timeline(id),
    retry: false,
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    await queryClient.invalidateQueries({ queryKey: ['timeline', id] });
    await queryClient.invalidateQueries({ queryKey: ['tickets'] });
    // Une sortie d'attente repousse les echeances : les badges les afficheraient
    // sinon perimees jusqu'au prochain rechargement complet.
    await queryClient.invalidateQueries({ queryKey: ['ticket-agreements', id] });
  };

  const publier = useMutation({
    mutationFn: () =>
      api.addFollowup(id, { content: suivi, isPrivate: prive, source: 'interface' }),
    onSuccess: async () => {
      setSuivi('');
      await rafraichir();
    },
  });

  const changerStatut = useMutation({
    mutationFn: (statut: ItilStatus) => api.setStatus(id, statut),
    onSuccess: rafraichir,
  });

  if (ticket.error instanceof ApiError) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {ticket.error.status === 403 ? t('tickets.interdit') : ticket.error.message}
      </p>
    );
  }

  if (!ticket.data) return <p className="text-sm text-neutral-500">{t('commun.chargement')}</p>;

  const detail = ticket.data;
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (suivi.trim().length > 0) publier.mutate();
  };

  return (
    <div className="space-y-5">
      <div>
        <Link to="/tickets" className="text-xs text-neutral-500 underline-offset-2 hover:underline">
          ← {t('tickets.detail.retour')}
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums text-neutral-500">#{detail.id}</span>
          <StatusBadge status={detail.status} />
          <PriorityBadge value={detail.priority} />
          <TypeBadge type={detail.type} />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{detail.name}</h2>
        <AgreementBadges ticketId={id} />
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <article className="whitespace-pre-wrap rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            {detail.content || '—'}
          </article>

          <Attachments itemType="ticket" itemId={id} />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('tickets.detail.chronologie')}</h3>

            {timeline.data && timeline.data.length === 0 && (
              <p className="text-sm text-neutral-500">{t('tickets.detail.aucuneEntree')}</p>
            )}

            <ul className="space-y-2">
              {(timeline.data ?? []).map((entree) => (
                <Entree
                  key={`${entree.kind}-${String(entree.id)}`}
                  entree={entree}
                  locale={i18n.language}
                />
              ))}
            </ul>
          </section>

          <form
            onSubmit={soumettre}
            className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
          >
            <h3 className="text-sm font-semibold">{t('tickets.detail.ajouterSuivi')}</h3>
            <textarea
              value={suivi}
              onChange={(event) => {
                setSuivi(event.target.value);
              }}
              rows={3}
              placeholder={t('tickets.detail.suiviPlaceholder')}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
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
                className="ml-auto rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                {t('tickets.detail.envoyer')}
              </button>
            </div>
            {publier.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{publier.error.message}</p>
            )}
          </form>
        </div>

        <aside className="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              {t('tickets.detail.changerStatut')}
            </span>
            <select
              value={detail.status}
              disabled={changerStatut.isPending}
              onChange={(event) => {
                changerStatut.mutate(itilStatusSchema.parse(event.target.value));
              }}
              className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            >
              {itilStatusSchema.options.map((statut) => (
                <option key={statut} value={statut}>
                  {t(`tickets.statuts.${statut}`)}
                </option>
              ))}
            </select>
          </label>

          {changerStatut.error && (
            <p className="text-xs text-red-600 dark:text-red-400">{changerStatut.error.message}</p>
          )}

          <dl className="space-y-3">
            <Champ libelle={t('tickets.entite')}>{detail.entity.name}</Champ>
            <Champ libelle={t('tickets.categorie')}>{detail.category?.name ?? '—'}</Champ>
            <Champ libelle={t('tickets.detail.urgence')}>{detail.urgency} / 5</Champ>
            <Champ libelle={t('tickets.detail.impact')}>{detail.impact} / 5</Champ>
            <Champ libelle={t('tickets.detail.source')}>{detail.requestSource?.name ?? '—'}</Champ>
            <Champ libelle={t('tickets.detail.lieu')}>{detail.location?.name ?? '—'}</Champ>
            <Champ libelle={t('tickets.ouvertLe')}>
              {dates.format(new Date(detail.dateOpened))}
            </Champ>
            {detail.dateTakenIntoAccount && (
              <Champ libelle={t('tickets.detail.priseEnCompte')}>
                {dates.format(new Date(detail.dateTakenIntoAccount))}
              </Champ>
            )}
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
            <h3 className="text-xs uppercase tracking-wide text-neutral-500">
              {t('tickets.detail.acteurs')}
            </h3>
            <ul className="space-y-1 text-sm">
              {detail.actors.map((acteur) => (
                <li key={`${acteur.role}-${acteur.actorType}-${String(acteur.actorId)}`}>
                  <span className="text-neutral-500">{t(`tickets.roles.${acteur.role}`)} : </span>
                  {acteur.label}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
