import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionContext } from '@tick/contracts';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Attachments } from '@/components/Attachments';
import { StatusBadge } from '@/components/TicketBadges';
import { IconRetour } from '@/components/ui/icons';
import { Button, Card, CardBody, FieldError, Notice, Textarea } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Un ticket, vu par celui qui l'a ouvert.
 *
 * Le technicien a besoin d'une fiche : urgence, impact, catégorie, affectation,
 * engagements, tâches, liens. Le demandeur, lui, veut savoir **où en est sa
 * demande** — et cela se lit comme une conversation, pas comme un formulaire en
 * lecture seule. C'est d'ailleurs ce qu'elle est déjà côté données : une suite
 * de messages entre lui et le support.
 *
 * Ce que cet écran retire n'est pas de la simplification cosmétique. L'urgence
 * et l'impact sont des grandeurs d'arbitrage interne ; le temps passé regarde
 * la facturation ; les tâches et les liens décrivent l'organisation du travail.
 * Les afficher à un demandeur ne l'informe pas, cela le noie — et lui laisse
 * croire qu'il a prise sur des réglages qui ne lui appartiennent pas.
 *
 * Les suivis privés ne sont pas filtrés ici : le serveur ne les envoie pas à qui
 * n'a que la portée `own`. Un filtre d'affichage serait une garantie de façade,
 * contournable en lisant la réponse de l'API.
 */

interface Message {
  cle: string;
  auteur: string | null;
  /** Vrai quand le message vient de la personne qui consulte. */
  deMoi: boolean;
  at: string;
  contenu: string;
  nature: 'message' | 'intervention' | 'solution';
  solutionEnAttente: boolean;
}

/** Ligne centrée du fil : un changement d'état, pas une prise de parole. */
function Jalon({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-1 text-xs text-faint">
      <span className="h-px flex-1 bg-line" />
      <span className="text-center">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </li>
  );
}

function Bulle({ message, horodatage }: { message: Message; horodatage: string }) {
  const { t } = useTranslation();

  return (
    <li className={cn('flex', message.deMoi ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[42rem] min-w-0 space-y-1', message.deMoi && 'text-right')}>
        <p className="px-1 text-xs text-faint">
          <span className="font-medium text-muted">
            {message.deMoi
              ? t('tickets.conversation.vous')
              : (message.auteur ?? t('tickets.conversation.support'))}
          </span>
          <span className="tabular-nums"> · {horodatage}</span>
        </p>

        {/*
          Le vermillon est la couleur de signal : il designe ce sur quoi on agit.
          L'employer comme fond de bulle en ferait de la decoration, et un fil de
          dix messages en serait sature. Ce qui distingue « moi » de « le
          support » est l'alignement et le filet -- une bulle bordee de vermillon
          a droite, une bulle sur papier a gauche.
        */}
        <div
          className={cn(
            'px-3.5 py-2.5 text-left text-sm leading-relaxed whitespace-pre-wrap',
            message.nature === 'solution'
              ? 'border-l-2 border-positive bg-positive-soft text-positive-ink'
              : message.deMoi
                ? 'border-r-2 border-brand bg-brand-soft text-ink'
                : 'border-l-2 border-line-strong bg-surface text-ink',
          )}
        >
          {message.nature !== 'message' && (
            <p className="mb-1 text-xs font-semibold tracking-wide uppercase opacity-80">
              {t(
                message.nature === 'solution'
                  ? 'tickets.conversation.solutionProposee'
                  : 'tickets.conversation.intervention',
              )}
            </p>
          )}
          {message.contenu}
        </div>
      </div>
    </li>
  );
}

export function TicketConversationPage({ session }: { session: SessionContext }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const params = useParams();
  const id = Number(params['id']);

  const [message, setMessage] = useState('');
  const finDuFil = useRef<HTMLDivElement>(null);

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.ticket(id),
    retry: false,
  });
  const fil = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => api.timeline(id),
    retry: false,
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    await queryClient.invalidateQueries({ queryKey: ['timeline', id] });
    await queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };

  const envoyer = useMutation({
    mutationFn: () =>
      api.addFollowup(id, { content: message, isPrivate: false, source: 'interface' }),
    onSuccess: async () => {
      setMessage('');
      await rafraichir();
    },
  });

  const repondreSolution = useMutation({
    mutationFn: (accepted: boolean) => api.answerSolution(id, { accepted }),
    onSuccess: rafraichir,
  });

  // Le fil se lit du plus ancien au plus récent : on arrive donc en bas, là où
  // se trouve la dernière nouvelle. Remonter est un geste volontaire.
  useEffect(() => {
    finDuFil.current?.scrollIntoView({ block: 'end' });
  }, [fil.data]);

  if (ticket.error instanceof ApiError) {
    return (
      <Notice ton={ticket.error.status === 403 ? 'attention' : 'critique'}>
        {ticket.error.status === 403 ? t('tickets.interdit') : ticket.error.message}
      </Notice>
    );
  }

  if (!ticket.data) return <p className="text-sm text-muted">{t('commun.chargement')}</p>;

  const detail = ticket.data;
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const clos = detail.status === 'closed';

  /**
   * La demande elle-même ouvre la conversation.
   *
   * Elle n'est pas une « description » posée à côté du fil : c'est le premier
   * message, celui auquel tout le reste répond. La sortir du fil obligerait à
   * lire deux endroits pour suivre un échange.
   */
  const ouverture: Message = {
    cle: 'demande',
    auteur: detail.actors.find((acteur) => acteur.role === 'requester')?.label ?? null,
    deMoi: true,
    at: detail.dateOpened,
    contenu: detail.content || detail.name,
    nature: 'message',
    solutionEnAttente: false,
  };

  const entrees = fil.data ?? [];

  const elements: (Message | { cle: string; jalon: string })[] = [ouverture];

  for (const entree of entrees) {
    if (entree.kind === 'log') {
      // Seuls les changements d'état parlent au demandeur. L'urgence, l'impact
      // ou la catégorie sont des arbitrages internes : les afficher donnerait à
      // lire une mécanique sur laquelle il n'a pas la main.
      if (entree.field !== 'status') continue;

      elements.push({
        cle: `log-${String(entree.id)}`,
        jalon: t('tickets.conversation.statut', {
          statut: t(`tickets.statuts.${entree.newValue ?? 'new'}` as 'tickets.statuts.new'),
        }),
      });

      continue;
    }

    if (entree.kind === 'validation') continue;

    const auteur = entree.author?.name ?? null;

    elements.push({
      cle: `${entree.kind}-${String(entree.id)}`,
      auteur,
      deMoi: entree.author?.id === session.user.id,
      at: entree.at,
      contenu: 'content' in entree ? entree.content : '',
      nature:
        entree.kind === 'solution'
          ? 'solution'
          : entree.kind === 'task'
            ? 'intervention'
            : 'message',
      solutionEnAttente: entree.kind === 'solution' && entree.status === 'proposed',
    });
  }

  const solutionEnAttente = elements.some(
    (element) => 'solutionEnAttente' in element && element.solutionEnAttente,
  );

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (message.trim().length > 0) envoyer.mutate();
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-col gap-4">
      <div className="space-y-3">
        <Link
          to="/tickets"
          className="inline-flex items-center gap-1.5 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          <IconRetour className="size-3.5" />
          {t('tickets.conversation.retour')}
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-md bg-sunken px-2 py-0.5 text-sm font-medium tabular-nums text-muted">
            #{detail.id}
          </span>
          <StatusBadge status={detail.status} />
          <span className="text-xs text-faint">
            {t('tickets.conversation.ouverteLe', {
              date: dates.format(new Date(detail.dateOpened)),
            })}
          </span>
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-balance">{detail.name}</h2>
      </div>

      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto py-1">
        {elements.map((element) =>
          'jalon' in element ? (
            <Jalon key={element.cle}>{element.jalon}</Jalon>
          ) : (
            <Bulle
              key={element.cle}
              message={element}
              horodatage={dates.format(new Date(element.at))}
            />
          ),
        )}
        <div ref={finDuFil} />
      </ul>

      {solutionEnAttente && !clos && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">{t('tickets.conversation.questionSolution')}</p>
            <Button
              variante="primaire"
              disabled={repondreSolution.isPending}
              onClick={() => {
                repondreSolution.mutate(true);
              }}
            >
              {t('tickets.conversation.accepter')}
            </Button>
            <Button
              disabled={repondreSolution.isPending}
              onClick={() => {
                repondreSolution.mutate(false);
              }}
            >
              {t('tickets.conversation.refuser')}
            </Button>
          </CardBody>
        </Card>
      )}

      <FieldError>{repondreSolution.error?.message}</FieldError>

      {clos ? (
        <Notice ton="info">{t('tickets.conversation.close')}</Notice>
      ) : (
        <form onSubmit={soumettre} className="space-y-2">
          <Textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
            rows={3}
            placeholder={t('tickets.conversation.placeholder')}
            aria-label={t('tickets.conversation.placeholder')}
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variante="primaire"
              disabled={envoyer.isPending || message.trim().length === 0}
              className="ml-auto"
            >
              {t('tickets.conversation.envoyer')}
            </Button>
          </div>
          <FieldError>{envoyer.error?.message}</FieldError>
        </form>
      )}

      <Attachments itemType="ticket" itemId={id} />
    </div>
  );
}
