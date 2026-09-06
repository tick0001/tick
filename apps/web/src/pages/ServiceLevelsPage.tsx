import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Agreement,
  AgreementLevel,
  Calendar,
  CalendarSegment,
  EscalationAction,
  Holiday,
  UpsertAgreement,
  UpsertCalendar,
} from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { BOUTON, BOUTON_PRIMAIRE, CARTE, CONTROLE } from '@/components/ui/primitives';

const JOURS = [1, 2, 3, 4, 5, 6, 0];

const ACTIONS_ESCALADE: EscalationAction[] = [
  'set_priority',
  'set_urgency',
  'assign_group',
  'assign_user',
  'add_observer',
  'notify',
];

function calendrierVide(): UpsertCalendar {
  return {
    name: '',
    comment: null,
    timezone: 'Europe/Paris',
    isRecursive: true,
    // Une semaine de bureau par défaut : c'est la configuration que neuf
    // organisations sur dix veulent, et la corriger coûte moins que la saisir.
    segments: [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, beginAt: '08:00', endAt: '12:00' },
      { weekday, beginAt: '13:00', endAt: '18:00' },
    ]),
    holidays: [],
  };
}

function versFormulaire(calendrier: Calendar): UpsertCalendar {
  return {
    name: calendrier.name,
    comment: calendrier.comment,
    timezone: calendrier.timezone,
    isRecursive: calendrier.isRecursive,
    segments: calendrier.segments.map((segment) => ({
      weekday: segment.weekday,
      beginAt: segment.beginAt.slice(0, 5),
      endAt: segment.endAt.slice(0, 5),
    })),
    holidays: calendrier.holidays.map((ferie) => ({
      name: ferie.name,
      day: ferie.day,
      isPerpetual: ferie.isPerpetual,
    })),
  };
}

function engagementVide(): UpsertAgreement {
  return {
    kind: 'sla',
    axis: 'ttr',
    name: '',
    comment: null,
    duration: 4 * 3600,
    calendarId: null,
    isRecursive: true,
    levels: [],
  };
}

function versFormulaireEngagement(engagement: Agreement): UpsertAgreement {
  return {
    kind: engagement.kind,
    axis: engagement.axis,
    name: engagement.name,
    comment: engagement.comment,
    duration: engagement.duration,
    calendarId: engagement.calendarId,
    isRecursive: engagement.isRecursive,
    levels: engagement.levels.map((niveau) => ({
      name: niveau.name,
      offsetSeconds: niveau.offsetSeconds,
      isActive: niveau.isActive,
      actions: niveau.actions.map((action) => ({ action: action.action, value: action.value })),
    })),
  };
}

/**
 * Calendriers et engagements de service.
 *
 * Les deux sur la même page parce qu'on ne règle jamais l'un sans regarder
 * l'autre : une durée de quatre heures ne veut rien dire tant qu'on ignore si
 * la nuit compte.
 */
export function ServiceLevelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const calendriers = useQuery({ queryKey: ['calendars'], queryFn: api.calendars, retry: false });
  const engagements = useQuery({ queryKey: ['agreements'], queryFn: api.agreements, retry: false });

  const [calendrierEdite, setCalendrierEdite] = useState<{
    id?: number;
    valeurs: UpsertCalendar;
  } | null>(null);
  const [engagementEdite, setEngagementEdite] = useState<{
    id?: number;
    valeurs: UpsertAgreement;
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const enregistrerCalendrier = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertCalendar }) =>
      api.saveCalendar(valeurs, id),
    onSuccess: async () => {
      setCalendrierEdite(null);
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['calendars'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimerCalendrier = useMutation({
    mutationFn: api.deleteCalendar,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['calendars'] }),
  });

  const enregistrerEngagement = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertAgreement }) =>
      api.saveAgreement(valeurs, id),
    onSuccess: async () => {
      setEngagementEdite(null);
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['agreements'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimerEngagement = useMutation({
    mutationFn: api.deleteAgreement,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['agreements'] }),
  });

  const interdit =
    (calendriers.error instanceof ApiError && calendriers.error.status === 403) ||
    (engagements.error instanceof ApiError && engagements.error.status === 403);

  if (interdit) {
    return (
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
        {t('entites.interdit')}
      </p>
    );
  }

  const majSegments = (
    valeurs: UpsertCalendar,
    index: number,
    patch: Partial<CalendarSegment>,
  ): UpsertCalendar => ({
    ...valeurs,
    segments: valeurs.segments.map((segment, position) =>
      position === index ? { ...segment, ...patch } : segment,
    ),
  });

  const majFeries = (
    valeurs: UpsertCalendar,
    index: number,
    patch: Partial<Holiday>,
  ): UpsertCalendar => ({
    ...valeurs,
    holidays: valeurs.holidays.map((ferie, position) =>
      position === index ? { ...ferie, ...patch } : ferie,
    ),
  });

  const majNiveaux = (
    valeurs: UpsertAgreement,
    index: number,
    patch: Partial<AgreementLevel>,
  ): UpsertAgreement => ({
    ...valeurs,
    levels: valeurs.levels.map((niveau, position) =>
      position === index ? { ...niveau, ...patch } : niveau,
    ),
  });

  return (
    <section className="space-y-8">
      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      {/* ---- Calendriers ---- */}
      <div className="space-y-3">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{t('calendriers.titre')}</h2>
          <p className="max-w-2xl text-sm text-muted">{t('calendriers.intro')}</p>
          <button
            type="button"
            className={BOUTON_PRIMAIRE}
            onClick={() => {
              setCalendrierEdite({ valeurs: calendrierVide() });
            }}
          >
            {t('calendriers.nouveau')}
          </button>
        </header>

        {calendriers.data?.length === 0 && (
          <p className="text-sm text-muted">{t('calendriers.aucun')}</p>
        )}

        <div className="grid gap-2 md:grid-cols-2">
          {calendriers.data?.map((calendrier) => (
            <div key={calendrier.id} className={CARTE}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{calendrier.name}</p>
                  <p className="text-xs text-muted">
                    {calendrier.timezone} · {calendrier.entityName}
                    {calendrier.isRecursive ? ' · ↓' : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      setCalendrierEdite({
                        id: calendrier.id,
                        valeurs: versFormulaire(calendrier),
                      });
                    }}
                  >
                    {t('commun.modifier')}
                  </button>
                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      supprimerCalendrier.mutate(calendrier.id);
                    }}
                  >
                    {t('calendriers.supprimer')}
                  </button>
                </div>
              </div>

              <p className="mt-2 text-xs text-muted">
                {calendrier.segments.length} {t('calendriers.plages').toLowerCase()} ·{' '}
                {calendrier.holidays.length} {t('calendriers.feries').toLowerCase()}
              </p>
            </div>
          ))}
        </div>

        {calendrierEdite && (
          <form
            className={`${CARTE} space-y-3`}
            onSubmit={(event) => {
              event.preventDefault();
              enregistrerCalendrier.mutate(calendrierEdite);
            }}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs text-muted">{t('calendriers.nom')}</span>
                <input
                  className={CONTROLE}
                  required
                  value={calendrierEdite.valeurs.name}
                  onChange={(event) => {
                    setCalendrierEdite({
                      ...calendrierEdite,
                      valeurs: { ...calendrierEdite.valeurs, name: event.target.value },
                    });
                  }}
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted">{t('calendriers.fuseau')}</span>
                <input
                  className={CONTROLE}
                  required
                  value={calendrierEdite.valeurs.timezone}
                  onChange={(event) => {
                    setCalendrierEdite({
                      ...calendrierEdite,
                      valeurs: { ...calendrierEdite.valeurs, timezone: event.target.value },
                    });
                  }}
                />
              </label>

              <label className="flex items-end gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={calendrierEdite.valeurs.isRecursive}
                  onChange={(event) => {
                    setCalendrierEdite({
                      ...calendrierEdite,
                      valeurs: {
                        ...calendrierEdite.valeurs,
                        isRecursive: event.target.checked,
                      },
                    });
                  }}
                />
                <span>{t('commun.recursif')}</span>
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">{t('calendriers.plages')}</p>
              {calendrierEdite.valeurs.segments.map((segment, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    className={`${CONTROLE} w-auto`}
                    value={segment.weekday}
                    onChange={(event) => {
                      setCalendrierEdite({
                        ...calendrierEdite,
                        valeurs: majSegments(calendrierEdite.valeurs, index, {
                          weekday: Number(event.target.value),
                        }),
                      });
                    }}
                  >
                    {JOURS.map((jour) => (
                      <option key={jour} value={jour}>
                        {t(`calendriers.jours.d${String(jour)}` as 'calendriers.jours.d0')}
                      </option>
                    ))}
                  </select>

                  <input
                    type="time"
                    className={`${CONTROLE} w-auto`}
                    value={segment.beginAt}
                    onChange={(event) => {
                      setCalendrierEdite({
                        ...calendrierEdite,
                        valeurs: majSegments(calendrierEdite.valeurs, index, {
                          beginAt: event.target.value,
                        }),
                      });
                    }}
                  />
                  <input
                    type="time"
                    className={`${CONTROLE} w-auto`}
                    value={segment.endAt}
                    onChange={(event) => {
                      setCalendrierEdite({
                        ...calendrierEdite,
                        valeurs: majSegments(calendrierEdite.valeurs, index, {
                          endAt: event.target.value,
                        }),
                      });
                    }}
                  />

                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      setCalendrierEdite({
                        ...calendrierEdite,
                        valeurs: {
                          ...calendrierEdite.valeurs,
                          segments: calendrierEdite.valeurs.segments.filter(
                            (_, position) => position !== index,
                          ),
                        },
                      });
                    }}
                  >
                    {t('recherche.retirer')}
                  </button>
                </div>
              ))}

              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  setCalendrierEdite({
                    ...calendrierEdite,
                    valeurs: {
                      ...calendrierEdite.valeurs,
                      segments: [
                        ...calendrierEdite.valeurs.segments,
                        { weekday: 1, beginAt: '09:00', endAt: '17:00' },
                      ],
                    },
                  });
                }}
              >
                {t('calendriers.ajouterPlage')}
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">{t('calendriers.feries')}</p>
              {calendrierEdite.valeurs.holidays.map((ferie, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${CONTROLE} w-48`}
                    value={ferie.name}
                    onChange={(event) => {
                      setCalendrierEdite({
                        ...calendrierEdite,
                        valeurs: majFeries(calendrierEdite.valeurs, index, {
                          name: event.target.value,
                        }),
                      });
                    }}
                  />
                  <input
                    type="date"
                    className={`${CONTROLE} w-auto`}
                    value={ferie.day}
                    onChange={(event) => {
                      setCalendrierEdite({
                        ...calendrierEdite,
                        valeurs: majFeries(calendrierEdite.valeurs, index, {
                          day: event.target.value,
                        }),
                      });
                    }}
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={ferie.isPerpetual}
                      onChange={(event) => {
                        setCalendrierEdite({
                          ...calendrierEdite,
                          valeurs: majFeries(calendrierEdite.valeurs, index, {
                            isPerpetual: event.target.checked,
                          }),
                        });
                      }}
                    />
                    {t('calendriers.perpetuel')}
                  </label>
                </div>
              ))}

              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  setCalendrierEdite({
                    ...calendrierEdite,
                    valeurs: {
                      ...calendrierEdite.valeurs,
                      holidays: [
                        ...calendrierEdite.valeurs.holidays,
                        { name: '', day: '2026-01-01', isPerpetual: true },
                      ],
                    },
                  });
                }}
              >
                {t('calendriers.ajouterFerie')}
              </button>
            </div>

            <div className="flex gap-2">
              <button type="submit" className={BOUTON}>
                {t('calendriers.enregistrer')}
              </button>
              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  setCalendrierEdite(null);
                }}
              >
                {t('creation.annuler')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ---- Engagements ---- */}
      <div className="space-y-3">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{t('engagements.titre')}</h2>
          <button
            type="button"
            className={BOUTON_PRIMAIRE}
            onClick={() => {
              setEngagementEdite({ valeurs: engagementVide() });
            }}
          >
            {t('engagements.nouveau')}
          </button>
        </header>

        {engagements.data?.length === 0 && (
          <p className="text-sm text-muted">{t('engagements.aucun')}</p>
        )}

        <div className="grid gap-2 md:grid-cols-2">
          {engagements.data?.map((engagement) => (
            <div key={engagement.id} className={CARTE}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{engagement.name}</p>
                  <p className="text-xs text-muted">
                    {t(`engagements.natures.${engagement.kind}`)} ·{' '}
                    {t(`engagements.axes.${engagement.axis}`)} ·{' '}
                    {String(Math.round(engagement.duration / 3600))} h ·{' '}
                    {engagement.calendarName ?? t('engagements.tempsCalendaire')}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      setEngagementEdite({
                        id: engagement.id,
                        valeurs: versFormulaireEngagement(engagement),
                      });
                    }}
                  >
                    {t('commun.modifier')}
                  </button>
                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      supprimerEngagement.mutate(engagement.id);
                    }}
                  >
                    {t('calendriers.supprimer')}
                  </button>
                </div>
              </div>

              {engagement.levels.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {engagement.levels.map((niveau, index) => (
                    <li key={index}>
                      {niveau.name} — {String(Math.abs(Math.round(niveau.offsetSeconds / 3600)))} h{' '}
                      {niveau.offsetSeconds < 0
                        ? t('engagements.avantEcheance')
                        : t('engagements.apresEcheance')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {engagementEdite && (
          <form
            className={`${CARTE} space-y-3`}
            onSubmit={(event) => {
              event.preventDefault();
              enregistrerEngagement.mutate(engagementEdite);
            }}
          >
            <div className="grid gap-3 md:grid-cols-4">
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs text-muted">{t('engagements.nom')}</span>
                <input
                  className={CONTROLE}
                  required
                  value={engagementEdite.valeurs.name}
                  onChange={(event) => {
                    setEngagementEdite({
                      ...engagementEdite,
                      valeurs: { ...engagementEdite.valeurs, name: event.target.value },
                    });
                  }}
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted">{t('engagements.nature')}</span>
                <select
                  className={CONTROLE}
                  value={engagementEdite.valeurs.kind}
                  onChange={(event) => {
                    setEngagementEdite({
                      ...engagementEdite,
                      valeurs: {
                        ...engagementEdite.valeurs,
                        kind: event.target.value as UpsertAgreement['kind'],
                      },
                    });
                  }}
                >
                  <option value="sla">{t('engagements.natures.sla')}</option>
                  <option value="ola">{t('engagements.natures.ola')}</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted">{t('engagements.axe')}</span>
                <select
                  className={CONTROLE}
                  value={engagementEdite.valeurs.axis}
                  onChange={(event) => {
                    setEngagementEdite({
                      ...engagementEdite,
                      valeurs: {
                        ...engagementEdite.valeurs,
                        axis: event.target.value as UpsertAgreement['axis'],
                      },
                    });
                  }}
                >
                  <option value="tto">{t('engagements.axes.tto')}</option>
                  <option value="ttr">{t('engagements.axes.ttr')}</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted">{t('engagements.duree')} (h)</span>
                <input
                  type="number"
                  min={1}
                  className={CONTROLE}
                  value={Math.round(engagementEdite.valeurs.duration / 3600)}
                  onChange={(event) => {
                    setEngagementEdite({
                      ...engagementEdite,
                      valeurs: {
                        ...engagementEdite.valeurs,
                        duration: Math.max(1, Number(event.target.value)) * 3600,
                      },
                    });
                  }}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs text-muted">{t('engagements.calendrier')}</span>
                <select
                  className={CONTROLE}
                  value={engagementEdite.valeurs.calendarId ?? ''}
                  onChange={(event) => {
                    setEngagementEdite({
                      ...engagementEdite,
                      valeurs: {
                        ...engagementEdite.valeurs,
                        calendarId: event.target.value === '' ? null : Number(event.target.value),
                      },
                    });
                  }}
                >
                  <option value="">{t('engagements.tempsCalendaire')}</option>
                  {calendriers.data?.map((calendrier) => (
                    <option key={calendrier.id} value={calendrier.id}>
                      {calendrier.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-end gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={engagementEdite.valeurs.isRecursive}
                  onChange={(event) => {
                    setEngagementEdite({
                      ...engagementEdite,
                      valeurs: {
                        ...engagementEdite.valeurs,
                        isRecursive: event.target.checked,
                      },
                    });
                  }}
                />
                <span>{t('commun.recursif')}</span>
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">{t('engagements.niveaux')}</p>

              {engagementEdite.valeurs.levels.map((niveau, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${CONTROLE} w-56`}
                    placeholder={t('engagements.nom')}
                    value={niveau.name}
                    onChange={(event) => {
                      setEngagementEdite({
                        ...engagementEdite,
                        valeurs: majNiveaux(engagementEdite.valeurs, index, {
                          name: event.target.value,
                        }),
                      });
                    }}
                  />

                  <input
                    type="number"
                    className={`${CONTROLE} w-24`}
                    value={Math.round(niveau.offsetSeconds / 3600)}
                    onChange={(event) => {
                      setEngagementEdite({
                        ...engagementEdite,
                        valeurs: majNiveaux(engagementEdite.valeurs, index, {
                          offsetSeconds: Number(event.target.value) * 3600,
                        }),
                      });
                    }}
                  />
                  <span className="text-xs text-muted">
                    h{' '}
                    {niveau.offsetSeconds < 0
                      ? t('engagements.avantEcheance')
                      : t('engagements.apresEcheance')}
                  </span>

                  <select
                    className={`${CONTROLE} w-auto`}
                    value={niveau.actions[0]?.action ?? 'notify'}
                    onChange={(event) => {
                      setEngagementEdite({
                        ...engagementEdite,
                        valeurs: majNiveaux(engagementEdite.valeurs, index, {
                          actions: [
                            {
                              action: event.target.value as EscalationAction,
                              value: niveau.actions[0]?.value ?? null,
                            },
                          ],
                        }),
                      });
                    }}
                  >
                    {ACTIONS_ESCALADE.map((action) => (
                      <option key={action} value={action}>
                        {t(`engagements.actions.${action}`)}
                      </option>
                    ))}
                  </select>

                  <input
                    className={`${CONTROLE} w-24`}
                    placeholder="valeur"
                    value={niveau.actions[0]?.value ?? ''}
                    onChange={(event) => {
                      setEngagementEdite({
                        ...engagementEdite,
                        valeurs: majNiveaux(engagementEdite.valeurs, index, {
                          actions: [
                            {
                              action: niveau.actions[0]?.action ?? 'notify',
                              value: event.target.value === '' ? null : event.target.value,
                            },
                          ],
                        }),
                      });
                    }}
                  />

                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      setEngagementEdite({
                        ...engagementEdite,
                        valeurs: {
                          ...engagementEdite.valeurs,
                          levels: engagementEdite.valeurs.levels.filter(
                            (_, position) => position !== index,
                          ),
                        },
                      });
                    }}
                  >
                    {t('recherche.retirer')}
                  </button>
                </div>
              ))}

              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  setEngagementEdite({
                    ...engagementEdite,
                    valeurs: {
                      ...engagementEdite.valeurs,
                      levels: [
                        ...engagementEdite.valeurs.levels,
                        {
                          name: '',
                          offsetSeconds: -3600,
                          isActive: true,
                          actions: [{ action: 'notify', value: null }],
                        },
                      ],
                    },
                  });
                }}
              >
                {t('engagements.ajouterNiveau')}
              </button>
            </div>

            <div className="flex gap-2">
              <button type="submit" className={BOUTON}>
                {t('calendriers.enregistrer')}
              </button>
              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  setEngagementEdite(null);
                }}
              >
                {t('creation.annuler')}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
