import { useInfiniteQuery } from '@tanstack/react-query';
import type { ItilStatus, SessionContext } from '@tick/contracts';
import { OPEN_STATUSES } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PluginSlot } from '@/components/PluginSlot';
import { PriorityBadge, StatusBadge, TypeBadge } from '@/components/TicketBadges';
import { IconPlus, IconRecherche } from '@/components/ui/icons';
import {
  Button,
  Checkbox,
  EmptyState,
  Input,
  Notice,
  PageHeader,
  TableWrap,
  Tabs,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';

type Vue = 'ouverts' | 'tous' | 'corbeille';

export function TicketsPage({ session }: { session: SessionContext }) {
  const { t, i18n } = useTranslation();
  const peutCreer = usePeut('ticket', 'create');
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
  const interdit = liste.error instanceof ApiError && liste.error.status === 403;

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('tickets.titre')}
        description={t('tickets.description')}
        action={
          <>
            <PluginSlot
              name="entity.list.actions"
              className="flex items-center gap-2"
              context={{ locale: i18n.language, entity: session.entity, profile: session.profile }}
            />
            {peutCreer && (
              <Link
                to="/tickets/new"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3.5 text-sm font-medium text-on-brand shadow-card transition-colors hover:bg-brand-hover"
              >
                <IconPlus className="size-4" />
                {t('creation.nouveau')}
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={vue}
          onChange={setVue}
          options={[
            { value: 'ouverts', label: t('tickets.filtres.ouverts') },
            { value: 'tous', label: t('tickets.filtres.tous') },
            { value: 'corbeille', label: t('tickets.filtres.corbeille') },
          ]}
        />

        <Checkbox
          checked={mine}
          onChange={(event) => {
            setMine(event.target.checked);
          }}
          label={<span className="text-xs text-muted">{t('tickets.filtres.mesTickets')}</span>}
        />

        <div className="relative ml-auto w-full sm:w-64">
          <IconRecherche className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={recherche}
            onChange={(event) => {
              setRecherche(event.target.value);
            }}
            placeholder={t('tickets.filtres.recherche')}
            className="pl-8"
          />
        </div>
      </div>

      {interdit && <Notice ton="attention">{t('tickets.interdit')}</Notice>}

      {liste.error && !interdit && <Notice ton="critique">{liste.error.message}</Notice>}

      {liste.isPending && <p className="text-sm text-muted">{t('commun.chargement')}</p>}

      {!liste.error && liste.data && tickets.length === 0 && (
        <EmptyState title={t('tickets.aucun')} />
      )}

      {!liste.error && tickets.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th className="w-16">{t('tickets.numero')}</Th>
              <Th className="w-40">{t('tickets.statut')}</Th>
              <Th className="w-24">{t('tickets.priorite')}</Th>
              <Th>{t('tickets.sujet')}</Th>
              <Th>{t('tickets.demandeurs')}</Th>
              <Th>{t('tickets.attribue')}</Th>
              <Th>{t('tickets.entite')}</Th>
              <Th className="whitespace-nowrap">{t('tickets.ouvertLe')}</Th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <Tr key={ticket.id}>
                <Td className="tabular-nums text-faint">#{ticket.id}</Td>
                <Td>
                  <StatusBadge status={ticket.status} />
                </Td>
                <Td>
                  <PriorityBadge value={ticket.priority} />
                </Td>
                <Td>
                  <Link
                    to={`/tickets/${String(ticket.id)}`}
                    className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
                  >
                    {ticket.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
                    <TypeBadge type={ticket.type} />
                    {ticket.category && <span>· {ticket.category.name}</span>}
                    {ticket.followupCount > 0 && (
                      <span>
                        · {ticket.followupCount} {t('tickets.suivis')}
                      </span>
                    )}
                  </div>
                </Td>
                <Td className="text-muted">{ticket.requesters.join(', ') || '—'}</Td>
                <Td className="text-muted">{ticket.assignees.join(', ') || '—'}</Td>
                <Td className="text-muted">{ticket.entity.name}</Td>
                <Td className="whitespace-nowrap text-muted">
                  {dates.format(new Date(ticket.dateOpened))}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {liste.hasNextPage && (
        <Button
          onClick={() => void liste.fetchNextPage()}
          disabled={liste.isFetchingNextPage}
          className="mx-auto flex"
        >
          {liste.isFetchingNextPage ? t('commun.chargement') : t('tickets.plus')}
        </Button>
      )}
    </section>
  );
}
