import { useInfiniteQuery } from '@tanstack/react-query';
import type { ItilStatus, SessionContext } from '@tick/contracts';
import { OPEN_STATUSES } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PluginSlot } from '@/components/PluginSlot';
import { PriorityBadge, StatusBadge, TypeBadge } from '@/components/TicketBadges';
import { ApiError, api } from '@/lib/api';

type Vue = 'ouverts' | 'tous' | 'corbeille';

export function TicketsPage({ session }: { session: SessionContext }) {
  const { t, i18n } = useTranslation();
  const [vue, setVue] = useState<Vue>('ouverts');
  const [mine, setMine] = useState(false);
  const [recherche, setRecherche] = useState('');

  const statuts: ItilStatus[] | undefined = vue === 'ouverts' ? [...OPEN_STATUSES] : undefined;

  const liste = useInfiniteQuery({
    queryKey: ['tickets', vue, mine, recherche],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.tickets({
        ...(statuts ? { status: statuts } : {}),
        ...(recherche ? { search: recherche } : {}),
        mine,
        deleted: vue === 'corbeille',
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (derniere) => derniere.nextCursor ?? undefined,
    retry: false,
  });

  const tickets = liste.data?.pages.flatMap((page) => page.items) ?? [];
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t('tickets.titre')}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t('tickets.description')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <PluginSlot
            name="entity.list.actions"
            className="flex items-center gap-2"
            context={{ locale: i18n.language, entity: session.entity, profile: session.profile }}
          />
          <Link
            to="/tickets/new"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {t('creation.nouveau')}
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
          {(['ouverts', 'tous', 'corbeille'] as const).map((valeur) => (
            <button
              key={valeur}
              type="button"
              onClick={() => {
                setVue(valeur);
              }}
              className={`px-3 py-1.5 text-xs transition ${
                vue === valeur
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {t(`tickets.filtres.${valeur}`)}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={mine}
            onChange={(event) => {
              setMine(event.target.checked);
            }}
          />
          {t('tickets.filtres.mesTickets')}
        </label>

        <input
          value={recherche}
          onChange={(event) => {
            setRecherche(event.target.value);
          }}
          placeholder={t('tickets.filtres.recherche')}
          className="ml-auto w-56 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
        />
      </div>

      {liste.error instanceof ApiError && liste.error.status === 403 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t('tickets.interdit')}
        </p>
      )}

      {liste.error && !(liste.error instanceof ApiError && liste.error.status === 403) && (
        <p className="text-sm text-red-600 dark:text-red-400">{liste.error.message}</p>
      )}

      {liste.isPending && <p className="text-sm text-neutral-500">{t('commun.chargement')}</p>}

      {!liste.error && liste.data && tickets.length === 0 && (
        <p className="text-sm text-neutral-500">{t('tickets.aucun')}</p>
      )}

      {!liste.error && tickets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2 font-medium">{t('tickets.numero')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.statut')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.priorite')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.sujet')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.demandeurs')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.attribue')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.entite')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.ouvertLe')}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="border-b border-neutral-100 transition last:border-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900"
                >
                  <td className="px-3 py-2 tabular-nums text-neutral-500">#{ticket.id}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge value={ticket.priority} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/tickets/${String(ticket.id)}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {ticket.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      <TypeBadge type={ticket.type} />
                      {ticket.category && (
                        <span className="text-xs text-neutral-500">{ticket.category.name}</span>
                      )}
                      {ticket.followupCount > 0 && (
                        <span className="text-xs text-neutral-400">
                          {ticket.followupCount} {t('tickets.suivis')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                    {ticket.requesters.join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                    {ticket.assignees.join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{ticket.entity.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-500">
                    {dates.format(new Date(ticket.dateOpened))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {liste.hasNextPage && (
        <button
          type="button"
          onClick={() => void liste.fetchNextPage()}
          disabled={liste.isFetchingNextPage}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {liste.isFetchingNextPage ? t('commun.chargement') : t('tickets.plus')}
        </button>
      )}
    </section>
  );
}
