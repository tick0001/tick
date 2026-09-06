import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItilStatus } from '@tick/contracts';
import { itilStatusSchema } from '@tick/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { AgreementBadges } from '@/components/AgreementBadges';
import { Attachments } from '@/components/Attachments';
import { LinksPanel } from '@/components/LinksPanel';
import { PriorityBadge, StatusBadge, TypeBadge } from '@/components/TicketBadges';
import { Timeline } from '@/components/Timeline';
import { IconRetour } from '@/components/ui/icons';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FieldError,
  Notice,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

/** Une ligne de la fiche latérale : libellé au-dessus, valeur en dessous. */
function Champ({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-faint">{libelle}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
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
      <Notice ton={ticket.error.status === 403 ? 'attention' : 'critique'}>
        {ticket.error.status === 403 ? t('tickets.interdit') : ticket.error.message}
      </Notice>
    );
  }

  if (!ticket.data) return <p className="text-sm text-muted">{t('commun.chargement')}</p>;

  const detail = ticket.data;
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (suivi.trim().length > 0) publier.mutate();
  };

  return (
    <div className="space-y-5">
      <Link
        to="/tickets"
        className="inline-flex items-center gap-1.5 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        <IconRetour className="size-3.5" />
        {t('tickets.detail.retour')}
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-md bg-sunken px-2 py-0.5 text-sm font-medium tabular-nums text-muted">
            #{detail.id}
          </span>
          <StatusBadge status={detail.status} />
          <PriorityBadge value={detail.priority} />
          <TypeBadge type={detail.type} />
        </div>

        <h2 className="text-2xl font-semibold tracking-tight text-balance">{detail.name}</h2>

        <AgreementBadges ticketId={id} />
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardBody className="whitespace-pre-wrap text-sm leading-relaxed">
              {detail.content || '—'}
            </CardBody>
          </Card>

          <Attachments itemType="ticket" itemId={id} />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('tickets.detail.chronologie')}</h3>
            <Timeline entrees={timeline.data} locale={i18n.language} />
          </section>

          <Card>
            <CardHeader title={t('tickets.detail.ajouterSuivi')} />
            <CardBody>
              <form onSubmit={soumettre} className="space-y-3">
                <Textarea
                  value={suivi}
                  onChange={(event) => {
                    setSuivi(event.target.value);
                  }}
                  rows={3}
                  placeholder={t('tickets.detail.suiviPlaceholder')}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Checkbox
                    checked={prive}
                    onChange={(event) => {
                      setPrive(event.target.checked);
                    }}
                    label={<span className="text-xs text-muted">{t('tickets.detail.suiviPrive')}</span>}
                  />
                  <Button
                    type="submit"
                    variante="primaire"
                    disabled={publier.isPending || suivi.trim().length === 0}
                    className="ml-auto"
                  >
                    {t('tickets.detail.envoyer')}
                  </Button>
                </div>
                <FieldError>{publier.error?.message}</FieldError>
              </form>
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardBody className="space-y-4">
              <Field label={t('tickets.detail.changerStatut')}>
                <Select
                  value={detail.status}
                  disabled={changerStatut.isPending}
                  onChange={(event) => {
                    changerStatut.mutate(itilStatusSchema.parse(event.target.value));
                  }}
                >
                  {itilStatusSchema.options.map((statut) => (
                    <option key={statut} value={statut}>
                      {t(`tickets.statuts.${statut}`)}
                    </option>
                  ))}
                </Select>
              </Field>

              <FieldError>{changerStatut.error?.message}</FieldError>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-3.5 border-t border-line pt-4">
                <Champ libelle={t('tickets.entite')}>{detail.entity.name}</Champ>
                <Champ libelle={t('tickets.categorie')}>{detail.category?.name ?? '—'}</Champ>
                <Champ libelle={t('tickets.detail.urgence')}>{detail.urgency} / 5</Champ>
                <Champ libelle={t('tickets.detail.impact')}>{detail.impact} / 5</Champ>
                <Champ libelle={t('tickets.detail.source')}>
                  {detail.requestSource?.name ?? '—'}
                </Champ>
                <Champ libelle={t('tickets.detail.lieu')}>{detail.location?.name ?? '—'}</Champ>
                <Champ libelle={t('tickets.ouvertLe')}>
                  {dates.format(new Date(detail.dateOpened))}
                </Champ>
                <Champ libelle={t('tickets.detail.tempsInterne')}>
                  {detail.internalTime} {t('tickets.detail.minutes')}
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
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('tickets.detail.acteurs')} />
            <CardBody>
              <ul className="space-y-2 text-sm">
                {detail.actors.map((acteur) => (
                  <li
                    key={`${acteur.role}-${acteur.actorType}-${String(acteur.actorId)}`}
                    className="flex items-center gap-2"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-[10px] font-semibold text-muted">
                      {acteur.label.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{acteur.label}</span>
                      <span className="block text-xs text-faint">
                        {t(`tickets.roles.${acteur.role}`)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </aside>
      </div>

      <LinksPanel type="ticket" id={id} />
    </div>
  );
}
